import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { parties, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { readPartyFinishReadiness } from "./finish-party-service.js";
import { createStation } from "./kitchen.js";
import { groupArrivingDishes } from "./order-groups.js";
import { readPassCardRows } from "./pass-board.js";
import { readRestOfOrder } from "./rest-of-order.js";
import { readStepFacts } from "./service-step-signals.js";
import { inTx, OPERATOR, revisionOf, seatWithNoAllergies } from "./testing/party-venue.js";
import { seedBillSetMenu } from "./testing/set-menu-bill-fixture.js";
import { setMenuBill, setupSetMenuReaders } from "./testing/set-menu-readers-fixture.js";

let fixture: Awaited<ReturnType<typeof setupSetMenuReaders>>;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    fixture = await setupSetMenuReaders(db);
    await inTx(fixture.venue, (tx) => createStation(tx, { name: "Kitchen", isDefault: true }));
  },
});

it("does not assign a group to a set menu when its bill arrives at a table", async () => {
  const { billId, partyId, menuLineId, dishId } = await setMenuBill(fixture);
  const { venue } = fixture;
  const result = await inTx(venue, (tx) =>
    groupArrivingDishes(tx, venue.cfg, partyId, billId, OPERATOR, new Map()),
  );
  expect(result.fired).not.toBeNull();
  const rows = await venue.db
    .select({ id: workingOrderLines.id, groupId: workingOrderLines.groupId })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
  expect(rows).toEqual([
    { id: menuLineId, groupId: null },
    { id: dishId, groupId: result.fired },
  ]);
  const pass = await inTx(venue, (tx) =>
    readPassCardRows(tx, { kind: "group", partyId, groupId: result.fired! }),
  );
  expect(pass.map((row) => row.lineId)).toEqual([dishId]);
  const rest = await inTx(venue, (tx) => readRestOfOrder(tx, [billId]));
  expect(rest.get(billId)?.map((item) => item.workingOrderLineId)).toEqual([dishId]);
});

it("reckons all served from the set menu's dish", async () => {
  const { tableId, partyId, billId, menuLineId, dishId } = await setMenuBill(fixture);
  const { venue, copy } = fixture;
  const servedAt = "2026-11-19T11:56:00.000Z";
  const facts = await inTx(venue, async (tx) => {
    const openedMenuAt = "2026-11-19T11:30:00.000Z";
    await tx
      .update(workingOrderLines)
      .set({ servedAt: openedMenuAt, sentAt: openedMenuAt })
      .where(eq(workingOrderLines.id, menuLineId));
    await tx
      .update(workingOrderLines)
      .set({ servedAt, servedQuantity: 1000 })
      .where(eq(workingOrderLines.id, dishId));
    await seedBillSetMenu(tx, billId, copy, 3);
    const [{ openedAt }] = await tx
      .select({ openedAt: parties.openedAt })
      .from(parties)
      .where(eq(parties.id, partyId));
    return readStepFacts(tx, [{ partyId, openedAt, tableIds: [tableId] }]);
  });
  expect(facts.get(tableId)?.facts.allServedAt).toBe(Date.parse(servedAt));
});

it("finishes service even if a settled bill's set-menu heading has no served quantity", async () => {
  const { billId, partyId, menuLineId, dishId } = await setMenuBill(fixture);
  const { venue } = fixture;
  const at = "2026-11-19T12:06:00.000Z";
  await inTx(venue, async (tx) => {
    await tx
      .update(workingOrderLines)
      .set({ servedAt: null, servedQuantity: 0 })
      .where(eq(workingOrderLines.id, menuLineId));
    await tx
      .update(workingOrders)
      .set({ status: "settled", settledAt: at })
      .where(eq(workingOrders.id, billId));
  });
  const expectedPartyRevision = await revisionOf(venue, partyId);
  const readiness = () =>
    inTx(venue, async (tx) =>
      readPartyFinishReadiness(tx, {
        partyId,
        expectedPartyRevision,
        operatorId: OPERATOR,
        expectedEdits: [await readBillEditState(tx, billId)],
      }),
    );
  expect(await readiness()).toEqual({ ready: false, blockers: ["service"] });
  await inTx(venue, (tx) =>
    tx
      .update(workingOrderLines)
      .set({ servedAt: at, servedQuantity: 1000 })
      .where(eq(workingOrderLines.id, dishId)),
  );
  expect(await readiness()).toEqual({ ready: true });
});

it("keeps a party open when its only unpaid item is a set menu", async () => {
  const { venue, copy } = fixture;
  const tableId = await venue.table(crypto.randomUUID());
  const { partyId, tabId, revision } = await seatWithNoAllergies(venue, tableId);
  const readiness = await inTx(venue, async (tx) => {
    await seedBillSetMenu(tx, tabId, copy, 1);
    return readPartyFinishReadiness(tx, {
      partyId,
      expectedPartyRevision: revision,
      operatorId: OPERATOR,
      expectedEdits: [await readBillEditState(tx, tabId)],
    });
  });
  expect(readiness).toEqual({ ready: false, blockers: ["other_bills"] });
});
