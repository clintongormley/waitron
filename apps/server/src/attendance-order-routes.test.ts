import { testTradingAdmission } from "./testing/trading-admission.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { newId, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

import { staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { mountTillApi } from "./till-api.js";
import { parkOrder } from "./working-order-open.js";
import { provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: BillVenue;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
  v = await provisionBillVenue(suite.db);
  const reading = v.clock.now();
  vi.spyOn(v.clock, "now").mockReturnValue({
    ...reading,
    instant: new Date("2026-01-05T16:40:00.987Z"),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function api(attendance: AttendanceRecorder | undefined = recordAttendanceFact) {
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
type Action = "park" | "save" | "line" | "label" | "discard";
async function action(app: Hono, id: string, kind: Action) {
  const extra = {
    personId: v.adminId,
    operatorId: v.adminId,
    at: "2026-01-06T22:00:00Z",
    offsetMinutes: -600,
  };
  const lines = [{ menuItemId: v.offerFor("House salad"), quantity: "1" }];
  if (kind === "park")
    return send(app, v.cookie, "POST", "/api/working-orders", {
      dining: "eat_in",
      id,
      lines,
      zoneId: v.zoneId,
      ...extra,
    });
  if (kind === "save") {
    const [line] = await suite.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    return send(app, v.cookie, "PUT", `/api/working-orders/${id}`, {
      dining: "eat_in",
      lines: [{ ...lines[0]!, workingOrderLineId: line!.id, quantity: "2" }],
      revision: 0,
      ...extra,
    });
  }
  if (kind === "line")
    return send(app, v.cookie, "PUT", `/api/working-orders/${id}/lines/1`, {
      portionLineNos: [],
      revision: 0,
      note: "No salt",
      ...extra,
    });
  if (kind === "label")
    return send(app, v.cookie, "PUT", `/api/working-orders/${id}/label`, {
      revision: 0,
      label: "New name",
      ...extra,
    });
  return send(app, v.cookie, "DELETE", `/api/working-orders/${id}`, extra);
}
async function prepare(kind: Action) {
  const id = newId();
  if (kind !== "park")
    await parkOrder({ db: suite.db }, v.cfg, {
      id,
      lines: [{ menuItemId: v.offerFor("House salad"), quantity: "1" }],
      zoneId: v.zoneId,
      operatorId: v.adminId,
    });
  return id;
}

describe("till order attendance admission", () => {
  it.each(["park", "save", "line", "label", "discard"] as const)(
    "%s captures the admitted operator and clock, ignoring supplied attribution",
    async (kind) => {
      const id = await prepare(kind);
      const result = await action(api(), id, kind);
      expect(result).toMatchObject({ status: 200 });
      expect(
        (await suite.db.select().from(staffActivity)).map((row) => [row.personId, row.lastAt]),
      ).toEqual([[v.operatorId, "2026-01-05T16:40:00.000Z"]]);
    },
  );
});
