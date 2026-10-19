import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import {
  saveDraftForTest as saveDraft,
  takeOverDraftForTest as takeOverDraft,
} from "./testing/draft-command-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  orderDraftEvents,
  orderGroupEvents,
  parties,
  orderDraftLines,
  orderDrafts,
  newId,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { migrationOptionsFor, manifestSets } from "@waitron/migrations";
import { eq } from "drizzle-orm";
import { finishTable } from "./testing/party-close-fixture.js";
import { persons } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { submitDraft, discardPartyDrafts, type Draft } from "./order-drafts.js";
import { setupPartyVenue, seat, OPERATOR, type PartyVenue } from "./testing/party-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, partyId: string, tabId: string, other: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00.987Z"));
  v = await setupPartyVenue(suite.db);
  await suite.db
    .insert(persons)
    .values({ id: OPERATOR, displayName: "Draft author", pinHash: "scrypt$00$00" });
  ({ partyId, tabId } = await seat(v, await v.table("Attendance")));
  const [row] = await suite.db
    .insert(persons)
    .values({ displayName: "Actual taker", pinHash: "scrypt$00$00" })
    .returning({ id: persons.id });
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
      v.cfg,
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
  suite.db.select().from(attendanceOperationFacts).orderBy(attendanceOperationFacts.sequence);

async function eventKey(
  draftId: string,
  kind: "created" | "taken_over" | "submitted" | "discarded",
) {
  const rows = await suite.db
    .select()
    .from(orderDraftEvents)
    .where(eq(orderDraftEvents.draftId, draftId));
  return `event:${rows.find((event) => event.kind === kind)!.id}`;
}

describe("accepted draft attendance capture", () => {
  it("Finish table preserves another worker's draft and attendance", async () => {
    const draft = await save();
    vi.setSystemTime(new Date("2026-01-05T14:00:00Z"));
    await expect(
      run((tx) =>
        finishTable(
          tx,
          { partyId, expectedPartyRevision: 0, operatorId: other },
          { recorder: recordAttendanceFact, locationId: v.cfg.locationId },
        ),
      ),
    ).rejects.toMatchObject({
      code: "draft.taken_over",
      params: { ownerId: OPERATOR, billId: tabId },
    });
    const [party] = await suite.db.select().from(parties).where(eq(parties.id, partyId));
    expect([party!.state, party!.revision]).toEqual(["open", 0]);
    expect(
      (await suite.db.select().from(orderDrafts)).map((d) => [d.id, d.state, d.revision]),
    ).toEqual([[draft.id, "open", draft.revision]]);
    expect((await operations()).map((r) => [r.key, r.personId, r.locationId, r.at])).toEqual([
      [await eventKey(draft.id, "created"), OPERATOR, v.cfg.locationId, "2026-01-05T09:00:00.000Z"],
      [
        `${draft.id}:${draft.revision}:save`,
        OPERATOR,
        v.cfg.locationId,
        "2026-01-05T09:00:00.000Z",
      ],
    ]);
  });
  it("a refused Finish reaches no close capture and retains the party, draft and attendance", async () => {
    const draft = await save();
    const before = await operations();
    const events = await suite.db.select().from(orderDraftEvents);
    vi.setSystemTime(new Date("2026-01-05T14:00:00Z"));
    const refusing = vi.fn<AttendanceRecorder>(async (tx, fact) => {
      await recordAttendanceFact(tx, fact);
      throw new AppError("attendance.invalid", { reason: "discard refused" });
    });
    await expect(
      run((tx) =>
        finishTable(
          tx,
          { partyId, expectedPartyRevision: 0, operatorId: other },
          { recorder: refusing, locationId: v.cfg.locationId },
        ),
      ),
    ).rejects.toMatchObject({
      code: "draft.taken_over",
      params: { ownerId: OPERATOR, billId: tabId },
    });
    expect(refusing).not.toHaveBeenCalled();
    expect(await operations()).toEqual(before);
    expect(await suite.db.select().from(orderDraftEvents)).toEqual(events);
    expect(
      (await suite.db.select().from(orderDrafts)).map((d) => [d.id, d.state, d.revision]),
    ).toEqual([[draft.id, "open", draft.revision]]);
    const [party] = await suite.db.select().from(parties).where(eq(parties.id, partyId));
    expect([party!.state, party!.revision]).toEqual(["open", 0]);
  });

  it("records every accepted save at its server instant and resulting revision", async () => {
    const first = await save();
    vi.setSystemTime(new Date("2026-01-05T11:00:00Z"));
    const second = await save(first);
    expect(
      (await operations()).map((r) => [r.key, r.personId, r.locationId, r.at, r.outcome]),
    ).toEqual([
      [
        await eventKey(first.id, "created"),
        OPERATOR,
        v.cfg.locationId,
        "2026-01-05T09:00:00.000Z",
        "qualifying",
      ],
      [
        `${first.id}:${first.revision}:save`,
        OPERATOR,
        v.cfg.locationId,
        "2026-01-05T09:00:00.000Z",
        "qualifying",
      ],
      [
        `${second.id}:${second.revision}:save`,
        OPERATOR,
        v.cfg.locationId,
        "2026-01-05T11:00:00.000Z",
        "qualifying",
      ],
    ]);
  });
  it("takeover credits the taker and taking one's own draft again creates no fact", async () => {
    const first = await save();
    vi.setSystemTime(new Date("2026-01-05T12:00:00Z"));
    const taken = await run((tx) =>
      takeOverDraft(tx, v.cfg, partyId, first.id, other, first.revision, recordAttendanceFact),
    );
    vi.setSystemTime(new Date("2026-01-05T16:00:00Z"));
    await run((tx) =>
      takeOverDraft(tx, v.cfg, partyId, first.id, other, taken.revision, recordAttendanceFact),
    );
    expect((await operations()).map((r) => [r.key, r.personId, r.at])).toEqual([
      [await eventKey(first.id, "created"), OPERATOR, "2026-01-05T09:00:00.000Z"],
      [`${first.id}:${first.revision}:save`, OPERATOR, "2026-01-05T09:00:00.000Z"],
      [await eventKey(first.id, "taken_over"), other, "2026-01-05T12:00:00.000Z"],
      [`${first.id}:${taken.revision}:take-over`, other, "2026-01-05T12:00:00.000Z"],
    ]);
  });
  it("a replayed submit returns the original result without a new activity instant", async () => {
    const first = await save();
    vi.setSystemTime(new Date("2026-01-05T12:00:00Z"));
    const input = {
      submissionId: newId(),
      expectedPartyRevision: 0,
      operatorId: OPERATOR,
      expectedEdit: await expectedDraftEditForTest(suite.db, first),
      draftRevision: first.revision,
      groups: [{ lineIds: first.lines.map((l) => l.id), release: "hold" as const }],
    };
    const result = await run((tx) =>
      submitDraft(tx, v.cfg, partyId, first.id, input, recordAttendanceFact),
    );
    const before = await operations();
    vi.setSystemTime(new Date("2026-01-06T18:00:00Z"));
    expect(
      await run((tx) => submitDraft(tx, v.cfg, partyId, first.id, input, recordAttendanceFact)),
    ).toEqual(result);
    expect(await operations()).toEqual(before);
    const [groupEvent] = await suite.db.select().from(orderGroupEvents);
    expect(before.map((r) => [r.key, r.at])).toEqual([
      [await eventKey(first.id, "created"), "2026-01-05T09:00:00.000Z"],
      [`${first.id}:${first.revision}:save`, "2026-01-05T09:00:00.000Z"],
      [`group:${groupEvent!.id}`, "2026-01-05T12:00:00.000Z"],
      [await eventKey(first.id, "submitted"), "2026-01-05T12:00:00.000Z"],
      [`${first.id}:${first.revision + 1}:submit`, "2026-01-05T12:00:00.000Z"],
    ]);
  });
  it("discard records the current operator and keeps the draft's original location", async () => {
    const first = await save();
    vi.setSystemTime(new Date("2026-01-05T14:00:00Z"));
    await run((tx) =>
      discardPartyDrafts(tx, partyId, other, {
        recorder: recordAttendanceFact,
        locationId: v.cfg.locationId,
      }),
    );
    const before = await operations();
    await run((tx) =>
      discardPartyDrafts(tx, partyId, other, {
        recorder: recordAttendanceFact,
        locationId: v.cfg.locationId,
      }),
    );
    expect(await operations()).toEqual(before);
    expect(before.map((r) => [r.key, r.personId, r.locationId, r.at])).toEqual([
      [await eventKey(first.id, "created"), OPERATOR, v.cfg.locationId, "2026-01-05T09:00:00.000Z"],
      [
        `${first.id}:${first.revision}:save`,
        OPERATOR,
        v.cfg.locationId,
        "2026-01-05T09:00:00.000Z",
      ],
      [await eventKey(first.id, "discarded"), other, v.cfg.locationId, "2026-01-05T14:00:00.000Z"],
      [
        `${first.id}:${first.revision + 1}:discard`,
        other,
        v.cfg.locationId,
        "2026-01-05T14:00:00.000Z",
      ],
    ]);
  });
  it("a refused stale save creates no activity", async () => {
    const first = await save();
    await save(first);
    const before = await operations();
    await expect(save(first)).rejects.toMatchObject({ code: "draft.out_of_date" });
    expect(await operations()).toEqual(before);
  });
  it("a capture refusal rolls back the accepted draft mutation and its audit events", async () => {
    const before = await suite.db.select().from(orderDraftEvents);
    await expect(
      save(undefined, async () => {
        throw new AppError("attendance.invalid", { reason: "capture refused" });
      }),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await suite.db.select().from(orderDrafts)).toEqual([]);
    expect(await suite.db.select().from(orderDraftLines)).toEqual([]);
    expect(await suite.db.select().from(orderDraftEvents)).toEqual(before);
    expect(await operations()).toEqual([]);
  });
  it("callers without a recorder save normally without operational attendance writes", async () => {
    const draft = await run((tx) =>
      saveDraft(tx, v.cfg, partyId, OPERATOR, {
        billId: tabId,
        draftId: null,
        revision: 0,
        lines: [line()],
      }),
    );
    expect(draft.lines.map((l) => l.quantity)).toEqual(["1.000"]);
    expect(await operations()).toEqual([]);
  });
});
