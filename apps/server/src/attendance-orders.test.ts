import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { abandonHeldOrder } from "./testing/order-writer-fixture.js";
import {
  updateHeldOrder,
  updateOrderLine,
  setWorkingOrderLabel,
} from "./testing/order-writer-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { floorZones, newId, withTransaction, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

import { createExtraList, createOptionList, writeProductModifiers } from "@waitron/menu";

import { setDepartmentSalePolicyField } from "@waitron/venue-service";
import { attendanceDays, staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";

import { switchOrderDining } from "./order-dining.js";
import { parkOrder } from "./working-order-open.js";
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
  await seedPersons(suite.db, {
    id: OPERATOR,
    displayName: "Original author",
    pinHash: "scrypt$00$00",
  });
  v = await setupPartyVenue(suite.db);

  const [person] = await seedPersons(suite.db, {
    displayName: "Actual editor",
    pinHash: "scrypt$00$00",
  });
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
  suite.db.select().from(staffActivity).orderBy(staffActivity.firstAt, staffActivity.id);
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

async function expectActivity(_id: string, _revision: number, _action: string, personId = worker) {
  expect((await operations()).map((row) => [row.personId, row.lastAt])).toEqual([
    [personId, "2026-01-05T16:40:00.000Z"],
  ]);
  expect(
    (await suite.db.select().from(attendanceDays)).map((r) => [r.businessDay, r.dirtyRevision]),
  ).toEqual([["2026-01-05", 1]]);
}
type Action = "park" | "save" | "line" | "label" | "dining" | "discard";
async function act(
  action: Action,
  id: string,
  recorder: AttendanceRecorder = recordAttendanceFact,
) {
  const attendance = capture(recorder);
  if (action === "park") return parkOrder({ db: suite.db }, v.cfg, request(id, worker), attendance);
  if (action === "save")
    return updateHeldOrder(
      { admission: testTradingAdmission(), db: suite.db },
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
      updateOrderLine(
        tx,
        v.cfg,
        id,
        1,
        { portionLineNos: [], note: "No salt" },
        0,
        worker,
        attendance,
      ),
    );
  if (action === "label")
    return setWorkingOrderLabel(
      suite.db,
      id,
      { label: "New name", revision: 0 },
      { ...attendance, personId: worker },
    );
  if (action === "dining") {
    await run(async (tx) => {
      const [zone] = await tx
        .select({ departmentId: floorZones.departmentId })
        .from(floorZones)
        .where(eq(floorZones.id, v.counter.zoneId));
      await setDepartmentSalePolicyField(tx, zone!.departmentId!, "dining", "till_choice");
    });
    return run((tx) =>
      switchOrderDining(
        tx,
        id,
        "takeaway",
        0,
        { operatorId: worker, expectedEdit: null },
        { ...attendance, personId: worker },
      ),
    );
  }
  return abandonHeldOrder({ db: suite.db }, v.cfg, id, { ...attendance, personId: worker });
}

describe("accepted order attendance", () => {
  it("a quantity-only line edit keeps line credit but captures its editor", async () => {
    const id = await parked();
    expect(
      await run((tx) =>
        updateOrderLine(
          tx,
          v.cfg,
          id,
          1,
          { portionLineNos: [], quantity: "2" },
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
    // One row of 2, or two portions of 1: either way still credited to the operator who parked it.
    expect([
      rows.reduce((sum, row) => sum + row.quantity, 0),
      [...new Set(rows.map((row) => row.creditedTo))],
    ]).toEqual([2000, [OPERATOR]]);
    await expectActivity(id, 1, "line");
  });
  it("a changed option captures the editor after the real option snapshot changes", async () => {
    const option = await run(async (tx) => {
      const option = await createOptionList(
        tx,
        {
          name: "Cooked",
          customerName: { es: "Cocción" },
          kitchenName: "COOK",
          labels: [
            { name: "Rare", customerName: { es: "Poco hecho" }, kitchenName: "RARE" },
            { name: "Well", customerName: { es: "Hecho" }, kitchenName: "WELL" },
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
          { portionLineNos: [], options: [{ listId: option.id, labelId: option.labels[1]!.id }] },
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
          customerName: { es: "Acompañamiento" },
          kitchenName: "SIDE",
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [
            { productId: v.productId("Water"), maxQuantity: 1, preselected: false, price: "0.50" },
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
            portionLineNos: [],
            extras: [
              { listId: list.id, picks: [{ productId: v.productId("Water"), quantity: 1 }] },
            ],
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
      [v.productId("Water"), false, 1000],
    ]);
    await expectActivity(id, 1, "line");
  });
  it.each(["park", "save", "line", "label", "dining", "discard"] as const)(
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
});
