import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { locations, newId, withTransaction, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons } from "@waitron/identity";
import { createExtraList, createOptionList, writeProductModifiers } from "@waitron/catalogue";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { readAttendanceFacts } from "./attendance-facts.js";
import {
  abandonHeldOrder,
  parkOrder,
  setWorkingOrderLabel,
  updateHeldOrder,
  updateOrderLine,
} from "./working-order.js";
import { setupPartyVenue, OPERATOR, type PartyVenue } from "./testing/party-venue.js";
import { republishMenus } from "./testing/publish-menu.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, worker: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00Z"));
  v = await setupPartyVenue(suite.db);
  await suite.db
    .insert(persons)
    .values({ id: OPERATOR, displayName: "Original author", pinHash: "scrypt$00$00" });
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Actual editor", pinHash: "scrypt$00$00" })
    .returning({ id: persons.id });
  worker = person!.id;
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
const capture = (recorder: AttendanceRecorder = recordAttendanceFact) => ({
  recorder,
  clock: v.clock,
});
const run = <T>(body: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, body);
const operations = () =>
  suite.db.select().from(attendanceOperationFacts).orderBy(attendanceOperationFacts.sequence);
const request = (id: string = newId(), actor = OPERATOR) => ({
  id,
  operatorId: actor,
  zoneId: v.counter.zoneId,
  lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
});
async function parked() {
  const req = request();
  await parkOrder({ db: suite.db }, v.cfg, req);
  return req.id;
}
async function line(id: string) {
  const [row] = await suite.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));
  return row!;
}
async function state() {
  return {
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    operations: await operations(),
    days: await suite.db.select().from(attendanceDayWork),
  };
}
async function expectActivity(id: string, revision: number, action: string, personId = worker) {
  expect(
    (await operations()).map((r) => [
      r.source,
      r.key,
      r.personId,
      r.locationId,
      r.kind,
      r.at,
      r.outcome,
    ]),
  ).toEqual([
    [
      "order",
      `${id}:${revision}:${action}`,
      personId,
      v.cfg.locationId,
      "order",
      "2026-01-05T16:40:00.000Z",
      "qualifying",
    ],
  ]);
  expect(
    (await suite.db.select().from(attendanceDayWork)).map((r) => [
      r.locationId,
      r.businessDay,
      r.dirtyRevision,
    ]),
  ).toEqual([[v.cfg.locationId, "2026-01-05", 1]]);
}
type Action = "park" | "save" | "line" | "label" | "discard";
async function act(
  action: Action,
  id: string,
  recorder: AttendanceRecorder = recordAttendanceFact,
) {
  const attendance = capture(recorder);
  if (action === "park") return parkOrder({ db: suite.db }, v.cfg, request(id, worker), attendance);
  if (action === "save")
    return updateHeldOrder(
      { db: suite.db },
      v.cfg,
      id,
      {
        operatorId: worker,
        revision: 0,
        lines: [
          {
            workingOrderLineId: (await line(id)).id,
            menuItemId: v.counterItem("Burger"),
            quantity: "2",
          },
        ],
      },
      undefined,
      attendance,
    );
  if (action === "line")
    return run((tx) =>
      updateOrderLine(tx, v.cfg, id, 1, { note: "No salt" }, 0, worker, attendance),
    );
  if (action === "label")
    return setWorkingOrderLabel(
      suite.db,
      id,
      { label: "New name", revision: 0 },
      { ...attendance, personId: worker },
    );
  return abandonHeldOrder({ db: suite.db }, v.cfg, id, { ...attendance, personId: worker });
}

describe("accepted order attendance", () => {
  it("a quantity-only line edit keeps line credit but captures its editor", async () => {
    const id = await parked();
    expect(
      await run((tx) => updateOrderLine(tx, v.cfg, id, 1, { quantity: "2" }, 0, worker, capture())),
    ).toBe(1);
    expect([(await line(id)).quantity, (await line(id)).creditedTo]).toEqual([2000, OPERATOR]);
    await expectActivity(id, 1, "line");
  });
  it("a changed option captures the editor after the real option snapshot changes", async () => {
    const option = await run(async (tx) => {
      const option = await createOptionList(
        tx,
        {
          name: "Cooked",
          customerName: { "es-ES": "Cocción" },
          kitchenName: "COOK",
          labels: [
            { name: "Rare", customerName: { "es-ES": "Poco hecho" }, kitchenName: "RARE" },
            { name: "Well", customerName: { "es-ES": "Hecho" }, kitchenName: "WELL" },
          ],
        },
        "es-ES",
      );
      await writeProductModifiers(tx, v.productId("Burger"), [{ kind: "options", id: option.id }]);
      await republishMenus(tx);
      return option;
    });
    const id = newId();
    await parkOrder({ db: suite.db }, v.cfg, {
      ...request(id),
      lines: [
        {
          ...request(id).lines[0]!,
          options: [{ listId: option.id, labelId: option.labels[0]!.id }],
        },
      ],
    });
    expect(
      await run((tx) =>
        updateOrderLine(
          tx,
          v.cfg,
          id,
          1,
          { options: [{ listId: option.id, labelId: option.labels[1]!.id }] },
          0,
          worker,
          capture(),
        ),
      ),
    ).toBe(1);
    expect((await line(id)).optionSnapshots.map((s) => s.labelKitchenName)).toEqual(["WELL"]);
    await expectActivity(id, 1, "line");
  });
  it("a changed extra captures the editor after the real extra child is added", async () => {
    const list = await run(async (tx) => {
      const list = await createExtraList(
        tx,
        {
          name: "Side",
          customerName: { "es-ES": "Acompañamiento" },
          kitchenName: "SIDE",
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [
            { productId: v.productId("Agua"), maxQuantity: 1, preselected: false, price: "0.50" },
          ],
        },
        "es-ES",
      );
      await writeProductModifiers(tx, v.productId("Burger"), [{ kind: "extras", id: list.id }]);
      await republishMenus(tx);
      return list;
    });
    const id = await parked();
    expect(
      await run((tx) =>
        updateOrderLine(
          tx,
          v.cfg,
          id,
          1,
          {
            extras: [{ listId: list.id, picks: [{ productId: v.productId("Agua"), quantity: 1 }] }],
          },
          0,
          worker,
          capture(),
        ),
      ),
    ).toBe(1);
    const rows = await suite.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(rows.map((r) => [r.productId, r.parentLineId === null, r.quantity])).toEqual([
      [v.productId("Burger"), true, 1000],
      [v.productId("Agua"), false, 1000],
    ]);
    await expectActivity(id, 1, "line");
  });
  it.each(["park", "save", "line", "label", "discard"] as const)(
    "captures %s under the editor at the trusted instant",
    async (action) => {
      const id = action === "park" ? newId() : await parked();
      await act(action, id);
      await expectActivity(id, ["park", "discard"].includes(action) ? 0 : 1, action);
      const [order] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
      expect(order!.status).toBe(action === "discard" ? "abandoned" : "open");
      if (action !== "park") expect((await line(id)).creditedTo).toBe(OPERATOR);
    },
  );
  it.each(["park", "save", "line", "label", "discard"] as const)(
    "a recorder refusal rolls back %s and its day work",
    async (action) => {
      const id = action === "park" ? newId() : await parked();
      const before = await state();
      await expect(
        act(action, id, async (tx, fact) => {
          await recordAttendanceFact(tx, fact);
          throw new AppError("attendance.invalid", { reason: "order capture refused" });
        }),
      ).rejects.toMatchObject({ code: "attendance.invalid" });
      expect(await state()).toEqual(before);
    },
  );
  it("a repeated park cannot credit a new actor or read a later clock", async () => {
    const req = request();
    const first = await parkOrder({ db: suite.db }, v.cfg, req, capture());
    const before = await state();
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("replay clock read");
    });
    expect(
      await parkOrder({ db: suite.db }, v.cfg, { ...req, operatorId: worker }, capture()),
    ).toEqual(first);
    await expectActivity(req.id, 0, "park", OPERATOR);
    expect(await state()).toEqual(before);
  });
  it("unchanged label, quantity and basket are not new work", async () => {
    const id = await parked();
    await setWorkingOrderLabel(suite.db, id, { label: "Name", revision: 0 });
    const row = await line(id);
    const before = await state();
    vi.spyOn(v.clock, "now").mockImplementation(() => {
      throw new Error("unchanged clock read");
    });
    expect(
      await setWorkingOrderLabel(
        suite.db,
        id,
        { label: "Name", revision: 1 },
        { ...capture(), personId: worker },
      ),
    ).toBe(1);
    expect(
      await run((tx) => updateOrderLine(tx, v.cfg, id, 1, { quantity: "1" }, 1, worker, capture())),
    ).toBe(1);
    expect(
      await updateHeldOrder(
        { db: suite.db },
        v.cfg,
        id,
        {
          label: "Name",
          revision: 1,
          operatorId: worker,
          lines: [
            { workingOrderLineId: row.id, menuItemId: v.counterItem("Burger"), quantity: "1" },
          ],
        },
        undefined,
        capture(),
      ),
    ).toBe(1);
    expect(await state()).toEqual(before);
  });
  it("stale line edits create no fact", async () => {
    const id = await parked();
    await act("line", id);
    const before = await state();
    await expect(act("line", id)).rejects.toMatchObject({ code: "working_order.out_of_date" });
    expect(await state()).toEqual(before);
  });
  it("a direct edit with no actor invents no worker from line credit", async () => {
    const id = await parked();
    expect(
      await run((tx) =>
        updateOrderLine(tx, v.cfg, id, 1, { note: "No salt" }, 0, undefined, capture()),
      ),
    ).toBe(1);
    expect((await line(id)).note).toBe("No salt");
    expect(await operations()).toEqual([]);
  });
  it("an edit keeps the order's recorded location when configuration points elsewhere", async () => {
    const id = await parked();
    const [other] = await suite.db
      .insert(locations)
      .values({
        name: "Elsewhere",
        invoiceLocales: ["es-ES"],
        operationDescription: "Other restaurant",
      })
      .returning({ id: locations.id });
    await run((tx) =>
      updateOrderLine(
        tx,
        { ...v.cfg, locationId: brandLocationId(other!.id) },
        id,
        1,
        { note: "No salt" },
        0,
        worker,
        capture(),
      ),
    );
    await expectActivity(id, 1, "line");
  });
  it("discarded unpaid edits remain readable as last activity", async () => {
    const id = await parked();
    await act("line", id);
    await abandonHeldOrder({ db: suite.db }, v.cfg, id);
    const facts = await run((tx) =>
      readAttendanceFacts(tx, {
        locationId: v.cfg.locationId,
        businessDay: "2026-01-05",
        startAt: "2026-01-05T03:00:00.000Z",
        endAt: "2026-01-06T03:00:00.000Z",
      }),
    );
    expect(facts.filter((f) => f.source === "order").map((f) => [f.key, f.personId, f.at])).toEqual(
      [[`${id}:1:line`, worker, "2026-01-05T16:40:00.000Z"]],
    );
  });
});
