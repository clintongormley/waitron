import { testTradingAdmission } from "./testing/trading-admission.js";
import { observedRelocationSender } from "./testing/table-action-fixture.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import {
  orderEvents,
  orderDraftLines,
  orderDrafts,
  parties,
  partyTables,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { attendanceDays, staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { readAttendanceFacts } from "./attendance-facts.js";

import { mountTillApi } from "./till-api.js";
import {
  provisionBillVenue,
  seatedWith,
  send as rawSend,
  type BillVenue,
} from "./testing/bill-venue.js";

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
      admission: testTradingAdmission(),
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
      saveDraft(tx, party.partyId, v.operatorId, {
        billId: party.tabId,
        draftId: null,
        revision: 0,
        lines: [{ menuItemId: v.offerFor("House salad"), quantity: "1" }],
      }),
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
    operatorId: v.adminId,
    at: "2026-01-06T20:00:00Z",
  });
}
/** Merge bills, after the combine, of the incoming party's bill into the surviving party's. */
async function mergeAfter(
  app: Hono,
  action: "join" | "move",
  p: Awaited<ReturnType<typeof prepare>>,
) {
  const [into, from] = action === "join" ? [p.source, p.target] : [p.target, p.source];
  const [party] = await suite.db.select().from(parties).where(eq(parties.id, into.partyId));
  return send(
    app,
    v.cookie,
    "POST",
    `/api/bills/${into.tabId}/merge`,
    await observedBillActionBody(v.db, `/api/bills/${into.tabId}/merge`, {
      fromBillId: from.tabId,
      expectedPartyRevision: party!.revision,
      partyId: into.partyId,
      operatorId: v.adminId,
      at: "2026-01-06T20:00:00Z",
    }),
  );
}
const state = async () => ({
  orders: await suite.db.select().from(workingOrders),
  parties: await suite.db.select().from(parties),
  tables: await suite.db.select().from(partyTables),
  drafts: await suite.db.select().from(orderDrafts),
  lines: await suite.db.select().from(orderDraftLines),
  events: await suite.db
    .select()
    .from(orderEvents)
    .where(sql`${orderEvents.kind} like 'draft.%'`),
  facts: await suite.db.select().from(staffActivity),
  days: await suite.db.select().from(attendanceDays),
});
describe("draft-event attendance in table combines", () => {
  it.each(["join", "move"] as const)(
    "%s keeps every bill and records nothing; Merge bills afterwards snapshots the admitted mover at the trusted instant",
    async (action) => {
      const p = await prepare();
      const before = await state();
      expect(await command(api(recordAttendanceFact), action, p)).toMatchObject({ status: 200 });
      const combined = await state();
      expect(combined.events).toEqual(before.events);
      expect(combined.facts).toEqual([]);
      expect(combined.drafts.map((draft) => draft.state)).toEqual(["open", "open"]);
      expect(await mergeAfter(api(recordAttendanceFact), action, p)).toMatchObject({
        status: 204,
      });
      const saved = await state();
      saved.events.filter((e) => !before.events.some((old) => old.id === e.id));

      expect(saved.facts).toMatchObject([
        { personId: v.operatorId, lastAt: "2026-01-05T16:40:00.000Z" },
      ]);
      await run((tx) =>
        readAttendanceFacts(tx, {
          businessDay: "2026-01-05",
          startAt: "2026-01-05T00:00:00Z",
          endAt: "2026-01-06T00:00:00Z",
        }),
      );
    },
  );
  it.each([false, true])(
    "a direct bill merge keeps draft-event attendance and its refusal rollback (refuse: %s)",
    async (refused) => {
      const p = await prepare();
      expect(
        await send(api(), v.cookie, "POST", `/api/parties/${p.source.partyId}/join`, {
          tableId: p.target.tableId,
          expectedPartyRevision: p.source.revision,
          otherPartyId: p.target.partyId,
          expectedOtherPartyRevision: p.target.revision,
        }),
      ).toMatchObject({ status: 200 });
      const before = await state();
      const party = before.parties.find((row) => row.id === p.source.partyId)!;
      const recorder: AttendanceRecorder = async (tx, fact) => {
        await recordAttendanceFact(tx, fact);
        if (refused && fact.source === "draft")
          throw new AppError("attendance.invalid", { reason: "draft merge refused" });
      };
      const response = await send(
        api(recorder),
        v.cookie,
        "POST",
        `/api/bills/${p.source.tabId}/merge`,
        await observedBillActionBody(v.db, `/api/bills/${p.source.tabId}/merge`, {
          fromBillId: p.target.tabId,
          expectedPartyRevision: party.revision,
          partyId: party.id,
          operatorId: v.adminId,
          at: "2026-01-06T20:00:00Z",
        }),
      );
      if (refused) {
        expect(response).toMatchObject({ status: 400, json: { code: "attendance.invalid" } });
        expect(await state()).toEqual(before);
      } else {
        expect(response.status).toBe(204);
        const saved = await state();
        saved.events.filter((event) => !before.events.some((old) => old.id === event.id));

        expect(saved.facts).toMatchObject([
          { personId: v.operatorId, lastAt: "2026-01-05T16:40:00.000Z" },
        ]);
      }
    },
  );
});

const send = observedRelocationSender(() => suite.db, rawSend);
