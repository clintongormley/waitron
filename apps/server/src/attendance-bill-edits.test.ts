import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { parties, workingOrders, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
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
const actions = ["split", "merge", "transfer"] as const;
type Action = (typeof actions)[number];
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
async function prepare(action: Action) {
  const party = await seatedWith(v, "Ensalada", "Tarta");
  let otherBillId: string | undefined;
  if (action !== "split") {
    const answer = await send(
      v.app,
      v.cookie,
      "POST",
      `/api/bills/${party.tabId}/split`,
      await observedBillActionBody(v.db, `/api/bills/${party.tabId}/split`, {
        expectedPartyRevision: party.revision,
        transfers: [{ lineNo: 2 }],
      }),
    );
    expect(answer.status).toBe(200);
    otherBillId = answer.json.billId as string;
  }
  const [stored] = await suite.db.select().from(parties).where(eq(parties.id, party.partyId));
  return { ...party, otherBillId, revision: stored!.revision };
}
async function command(app: Hono, action: Action, p: Awaited<ReturnType<typeof prepare>>) {
  const path = `/api/bills/${p.tabId}/${action}`;
  return send(
    app,
    v.cookie,
    "POST",
    path,
    await observedBillActionBody(v.db, path, {
      expectedPartyRevision: p.revision,
      operatorId: v.adminId,
      at: "2026-01-06T22:00:00Z",
      ...(action === "merge"
        ? { fromBillId: p.otherBillId }
        : {
            transfers: [{ lineNo: action === "split" ? 2 : 1 }],
            ...(action === "transfer" ? { toBillId: p.otherBillId } : {}),
          }),
    }),
  );
}
const state = async () => ({
  orders: await suite.db.select().from(workingOrders),
  lines: await suite.db.select().from(workingOrderLines),
  parties: await suite.db.select().from(parties),
  facts: await suite.db.select().from(attendanceOperationFacts),
  days: await suite.db.select().from(attendanceDayWork),
});
describe("accepted bill edits as order activity", () => {
  it.each(actions)(
    "%s captures both bills under the admitted editor and one trusted instant",
    async (action) => {
      const p = await prepare(action);
      const reading = v.clock.now();
      vi.spyOn(v.clock, "now")
        .mockReturnValueOnce(reading)
        .mockReturnValue({ ...reading, instant: new Date("2026-01-05T18:00:00Z") });
      const answer = await command(api(recordAttendanceFact), action, p);
      expect(answer.status).toBe(action === "split" ? 200 : 204);
      const otherBill = action === "split" ? (answer.json.billId as string) : p.otherBillId!;
      const saved = await state();
      expect(saved.facts.map((f) => [f.source, f.personId, f.locationId, f.at, f.outcome])).toEqual(
        [
          ["order", v.operatorId, v.cfg.locationId, "2026-01-05T16:40:00.000Z", "qualifying"],
          ["order", v.operatorId, v.cfg.locationId, "2026-01-05T16:40:00.000Z", "qualifying"],
        ],
      );
      expect(saved.facts.map((f) => f.key.split(":")[1]).sort()).toEqual(
        [p.tabId, otherBill].sort(),
      );
      expect(await command(api(recordAttendanceFact), action, p)).toMatchObject({
        status: 409,
        json: { code: "party.out_of_date" },
      });
      expect(await state()).toEqual(saved);
    },
  );
  it.each(actions)(
    "%s capture refusal rolls back both bills, their lines and the party revision",
    async (action) => {
      const p = await prepare(action);
      const before = await state();
      let captured = 0;
      const refuse: AttendanceRecorder = async (tx, fact) => {
        await recordAttendanceFact(tx, fact);
        if (++captured === 2)
          throw new AppError("attendance.invalid", { reason: "second bill capture refused" });
      };
      expect(await command(api(refuse), action, p)).toMatchObject({
        status: 400,
        json: { code: "attendance.invalid" },
      });
      expect(await state()).toEqual(before);
    },
  );
  it.each(actions)(
    "%s without workforce capture keeps its normal result without attendance writes",
    async (action) => {
      const p = await prepare(action);
      expect((await command(api(), action, p)).status).toBe(action === "split" ? 200 : 204);
      const saved = await state();
      expect(saved.facts).toEqual([]);
      expect(saved.days).toEqual([]);
    },
  );
});
