import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  locations,
  newId,
  orderDraftEvents,
  orderDraftLines,
  orderDrafts,
  orderGroups,
  parties,
  partyTables,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { readAttendanceFacts } from "./attendance-facts.js";
import { saveDraft } from "./order-drafts.js";
import { submitGroups } from "./order-groups.js";
import { mountTillApi } from "./till-api.js";
import { provisionBillVenue, seatedWith, send, type BillVenue } from "./testing/bill-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: BillVenue;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
  v = await provisionBillVenue(suite.db);
  vi.spyOn(v.clock, "now").mockReturnValue({
    ...v.clock.now(),
    instant: new Date("2026-01-05T16:40:00.987Z"),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const run = <T>(body: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, body);
function api(attendance?: AttendanceRecorder) {
  const app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      cfg: v.cfg,
      backend: v.backend,
      clock: v.clock,
      secureCookies: false,
      venueLocale: "es",
      attendance,
    },
    () => {},
  );
  return app;
}
async function prepare() {
  const source = await seatedWith(v);
  const target = await seatedWith(v);
  for (const party of [source, target]) {
    await run((tx) =>
      saveDraft(tx, v.cfg, party.partyId, v.adminId, { draftId: null, revision: 0, lines: [] }),
    );
  }
  return { source, target };
}
function command(app: Hono, action: "join" | "move", p: Awaited<ReturnType<typeof prepare>>) {
  return send(app, v.cookie, "POST", `/api/parties/${p.source.partyId}/${action}`, {
    [action === "join" ? "tableId" : "toTableId"]: p.target.tableId,
    expectedPartyRevision: p.source.revision,
    otherPartyId: p.target.partyId,
    expectedOtherPartyRevision: p.target.revision,
    bills: "separate",
    operatorId: v.adminId,
    at: "2026-01-06T20:00:00Z",
  });
}
const state = async () => ({
  orders: await suite.db.select().from(workingOrders),
  parties: await suite.db.select().from(parties),
  tables: await suite.db.select().from(partyTables),
  drafts: await suite.db.select().from(orderDrafts),
  lines: await suite.db.select().from(orderDraftLines),
  events: await suite.db.select().from(orderDraftEvents),
  facts: await suite.db.select().from(attendanceOperationFacts),
  days: await suite.db.select().from(attendanceDayWork),
});
describe("draft-event attendance in table combines", () => {
  it("party flags and reminder timing do not become order or payment activity", async () => {
    const p = await seatedWith(v);
    const held = await run((tx) =>
      submitGroups(tx, v.cfg, p.partyId, {
        submissionId: newId(),
        expectedPartyRevision: p.revision,
        operatorId: v.adminId,
        groups: [
          { release: "hold", lines: [{ menuItemId: v.offerFor("Ensalada"), quantity: "1" }] },
        ],
      }),
    );
    const before = await state();
    const app = api(recordAttendanceFact);
    let revision = held.revision;
    const flags = await send(app, v.cookie, "POST", `/api/parties/${p.partyId}/bill-request`, {
      submissionId: newId(),
      expectedPartyRevision: revision,
      requested: true,
    });
    expect(flags).toMatchObject({
      status: 200,
      json: { billRequestedAt: "2026-01-05T09:00:00.000Z" },
    });
    revision = flags.json.revision as number;
    const name = await send(app, v.cookie, "PUT", `/api/parties/${p.partyId}/name`, {
      expectedPartyRevision: revision,
      name: "New party label",
    });
    expect(name.status).toBe(200);
    const [party] = await suite.db.select().from(parties).where(eq(parties.id, p.partyId));
    expect(party!.name).toBe("New party label");
    revision = party!.revision;
    for (const action of ["snooze", "unsnooze"] as const) {
      const answer = await send(
        app,
        v.cookie,
        "POST",
        `/api/parties/${p.partyId}/groups/${held.groups[0]!.id}/${action}`,
        {
          submissionId: newId(),
          expectedPartyRevision: revision,
          ...(action === "snooze" ? { minutes: 5 } : {}),
        },
      );
      expect(answer.status).toBe(200);
      revision = answer.json.revision as number;
      const [group] = await suite.db
        .select()
        .from(orderGroups)
        .where(eq(orderGroups.id, held.groups[0]!.id));
      expect(group!.remindAt).toBe(action === "snooze" ? "2026-01-05T09:05:00.000Z" : null);
    }
    const after = await state();
    expect(after.events).toEqual(before.events);
    expect(after.orders).toEqual(before.orders);
    expect(after.facts).toEqual([]);
    expect(after.days).toEqual([]);
  });
  it.each(["join", "move"] as const)(
    "%s snapshots the admitted mover at the trusted instant",
    async (action) => {
      const p = await prepare();
      const before = await state();
      expect(await command(api(recordAttendanceFact), action, p)).toMatchObject({ status: 200 });
      const saved = await state();
      const events = saved.events.filter((e) => !before.events.some((old) => old.id === e.id));
      expect(events.map((e) => [e.kind, e.actorId])).toEqual([["discarded", v.operatorId]]);
      expect(saved.facts).toEqual([
        expect.objectContaining({
          source: "draft",
          key: `event:${events[0]!.id}`,
          personId: v.operatorId,
          locationId: v.cfg.locationId,
          at: "2026-01-05T16:40:00.000Z",
          outcome: "qualifying",
        }),
      ]);
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
      await suite.db.update(workingOrders).set({ locationId: elsewhere!.id });
      const facts = await run((tx) =>
        readAttendanceFacts(tx, {
          locationId: v.cfg.locationId,
          businessDay: "2026-01-05",
          startAt: "2026-01-05T00:00:00Z",
          endAt: "2026-01-06T00:00:00Z",
        }),
      );
      expect(facts.filter((f) => f.key === `event:${events[0]!.id}`)).toEqual([
        expect.objectContaining({
          personId: v.operatorId,
          locationId: v.cfg.locationId,
          at: "2026-01-05T16:40:00.000Z",
        }),
      ]);
    },
  );
  it.each(["join", "move"] as const)(
    "%s rolls back every table on snapshot refusal",
    async (action) => {
      const p = await prepare();
      const before = await state();
      const refuse: AttendanceRecorder = async (tx, fact) => {
        await recordAttendanceFact(tx, fact);
        throw new AppError("attendance.invalid", { reason: "merge snapshot refused" });
      };
      expect(await command(api(refuse), action, p)).toMatchObject({
        status: 400,
        json: { code: "attendance.invalid" },
      });
      expect(await state()).toEqual(before);
    },
  );
  it("a table combine without workforce capture retains the event without attendance writes", async () => {
    const p = await prepare();
    expect(await command(api(), "join", p)).toMatchObject({ status: 200 });
    const saved = await state();
    expect(saved.events.filter((e) => e.kind === "discarded")).toHaveLength(1);
    expect(saved.facts).toEqual([]);
    expect(saved.days).toEqual([]);
  });
});
