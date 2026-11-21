import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { devices, deviceProfiles, drawerEntries, drawerOpens, printers } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import {
  cashPayment,
  inTx,
  paymentRows,
  provisionBillVenue,
  send,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";

const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: BillVenue;
beforeEach(async () => {
  venue = await provisionBillVenue(store.db);
});

async function assignedPrinter() {
  const [device] = await store.db.select().from(devices).where(eq(devices.id, venue.deviceId));
  return { id: device!.cashDrawerPrinterId!, profileId: device!.deviceProfileId };
}

async function assignAnotherDrawer() {
  return inTx(venue, async (tx) => {
    const other = await createPrinter(tx, {
      name: "Other drawer",
      transport: "network_tcp",
      host: "other.test",
      hasCashDrawer: true,
    });
    await tx
      .update(devices)
      .set({ cashDrawerPrinterId: other.id })
      .where(eq(devices.id, venue.deviceId));
    return other.id;
  });
}

function entries() {
  return store.db.select().from(drawerEntries).orderBy(drawerEntries.sequence);
}

it("keeps the old assignment and records payments on a switched-off new drawer without a kick", async () => {
  const { id: original } = await assignedPrinter();
  const first = await tabWith(venue, "Croquettes");
  expect((await cashPayment(venue, venue.cookie, first, "12.00")).status).toBe(200);
  const switched = await assignAnotherDrawer();
  await inTx(venue, (tx) =>
    tx.update(printers).set({ active: false }).where(eq(printers.id, switched)),
  );
  const second = await tabWith(venue, "Octopus");
  expect((await cashPayment(venue, venue.cookie, second, "25.00")).status).toBe(200);
  expect(await entries()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        printerId: original,
        kind: "cash_payment",
        amount: 1000,
        sequence: 1,
      }),
      expect.objectContaining({
        printerId: switched,
        kind: "cash_payment",
        amount: 2000,
        sequence: 1,
      }),
    ]),
  );
  expect(await store.db.select({ printerId: drawerOpens.printerId }).from(drawerOpens)).toEqual([
    { printerId: original },
  ]);
});

it.each(["no assignment", "no drawer permission"])(
  "takes cash with %s and leaves no drawer entry",
  async (mode) => {
    if (mode === "no assignment") {
      await inTx(venue, (tx) =>
        tx.update(devices).set({ cashDrawerPrinterId: null }).where(eq(devices.id, venue.deviceId)),
      );
    } else {
      const { profileId } = await assignedPrinter();
      await inTx(venue, async (tx) => {
        const [profile] = await tx
          .select()
          .from(deviceProfiles)
          .where(eq(deviceProfiles.id, profileId));
        await tx
          .update(deviceProfiles)
          .set({
            capabilities: (profile!.capabilities as string[]).filter(
              (flag) => flag !== "open-cash-drawer",
            ),
          })
          .where(eq(deviceProfiles.id, profileId));
      });
    }
    const bill = await tabWith(venue, "Croquettes");
    expect((await cashPayment(venue, venue.cookie, bill, "12.00")).status).toBe(200);
    expect(await entries()).toEqual([]);
  },
);

it("records cash and a returned tip once despite payment and refund replays", async () => {
  const bill = await tabWith(venue, "Croquettes");
  const path = `/api/working-orders/${bill}/payments`;
  const request = {
    submissionId: randomUUID(),
    kind: "contribution",
    amount: "3.00",
    method: "cash",
    tendered: "5.00",
    applied: "3.00",
    tip: "1.00",
    addedTip: "1.00",
  };
  const paid = await send(venue.app, venue.cookie, "POST", path, request);
  expect(paid).toMatchObject({ status: 200, json: { payment: { change: "1.00" } } });
  const paymentId = (paid.json.payment as { id: string }).id;
  expect(await send(venue.app, venue.cookie, "POST", path, request)).toMatchObject({
    status: 200,
    json: { payment: { id: paymentId } },
  });

  const refundPath = `${path}/${paymentId}/refunds`;
  const refund = {
    submissionId: randomUUID(),
    appliedAmount: "3.00",
    tipAmount: "1.00",
    reason: "Overcharged",
    override: { personId: venue.adminId, pin: "1234" },
  };
  const returned = await send(venue.app, venue.cookie2, "POST", refundPath, refund);
  expect(returned).toMatchObject({ status: 200, json: { refund: { state: "completed" } } });
  const refundId = (returned.json.refund as { id: string }).id;
  expect(await send(venue.app, venue.cookie2, "POST", refundPath, refund)).toMatchObject({
    status: 200,
    json: { refund: { id: refundId } },
  });
  expect(await entries()).toMatchObject([
    { billPaymentId: paymentId, deviceId: venue.deviceId, amount: 400, sequence: 1 },
    { refundId, deviceId: venue.device2Id, amount: -400, sequence: 2 },
  ]);
});

it("uses the assignment when a reader captures the card, with no kick", async () => {
  const bill = await tabWith(venue, "Croquettes");
  const release = venue.card.holdNextCollect();
  const answer = send(venue.app, venue.cookie, "POST", `/api/working-orders/${bill}/payments`, {
    submissionId: randomUUID(),
    kind: "share",
    shareOf: 1,
    method: "card",
    entry: "reader",
    applied: "10.00",
    tip: "0.00",
  });
  let switched;
  try {
    await vi.waitFor(() => expect(venue.card.collectCalls).toHaveLength(1));
    expect(await entries()).toEqual([]);
    switched = await assignAnotherDrawer();
  } finally {
    release();
  }
  expect(await answer).toMatchObject({ status: 200, json: { payment: { state: "received" } } });
  expect(await entries()).toMatchObject([
    { printerId: switched, kind: "card_payment", amount: 1000, sequence: 1 },
  ]);
  expect(await store.db.select().from(drawerOpens)).toEqual([]);
});

it("rolls back the drawer entry when the sale fails later in the payment transaction", async () => {
  const bill = await tabWith(venue, "Croquettes");
  store.db.run(sql`
    create trigger test_refuse_settlement before insert on sale_settlements
    when exists (select 1 from drawer_entries where kind = 'cash_payment')
    begin select raise(abort, 'test refuses settlement after drawer entry'); end
  `);
  try {
    expect((await cashPayment(venue, venue.cookie, bill, "12.00")).status).toBe(500);
    expect(await paymentRows(venue, bill)).toEqual([]);
    expect(await entries()).toEqual([]);
  } finally {
    store.db.run(sql`drop trigger test_refuse_settlement`);
  }
  expect((await cashPayment(venue, venue.cookie, bill, "12.00")).status).toBe(200);
  expect(await entries()).toMatchObject([{ kind: "cash_payment", amount: 1000, sequence: 1 }]);
});
