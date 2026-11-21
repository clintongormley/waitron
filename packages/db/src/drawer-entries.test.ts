import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { appendDrawerEntry } from "./drawer-entries.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { billPayments } from "./schema/bill-payments.js";
import { printers } from "./schema/printers.js";
import {
  seedCashSale,
  seedCompletedCashRefund,
  seedDevice,
  seedPerson,
  seedVenueSettings,
  seedWorkingOrder,
} from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";

const fx = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("sequences entries from different tills by drawer and keeps signed cash distinct from card totals", async () => {
  await seedVenueSettings(fx.db);
  const personId = await seedPerson(fx.db);
  const sale = await seedCashSale(fx.db);
  const refundId = await seedCompletedCashRefund(fx.db, { ...sale, personId });
  const order = await seedWorkingOrder(fx.db);
  const first = await seedDevice(fx.db);
  const second = await seedDevice(fx.db);
  const [bar, terrace] = await fx.db
    .insert(printers)
    .values([
      { name: "Bar drawer", transport: "network_tcp", host: "bar.test", hasCashDrawer: true },
      {
        name: "Terrace drawer",
        transport: "network_tcp",
        host: "terrace.test",
        hasCashDrawer: true,
      },
    ])
    .returning();
  const paidAt = "2026-11-21T12:00:00.000Z";
  const [cash, card] = await fx.db
    .insert(billPayments)
    .values([
      {
        workingOrderId: order.id,
        submissionId: "cash",
        fingerprint: "cash",
        kind: "contribution",
        method: "cash",
        applied: 900,
        tip: 100,
        tendered: 2000,
        state: "received",
        requestedBy: personId,
        source: "device",
        deviceId: first.deviceId,
        receivedAt: paidAt,
      },
      {
        workingOrderId: order.id,
        submissionId: "card",
        fingerprint: "card",
        kind: "contribution",
        method: "card",
        applied: 1500,
        state: "received",
        requestedBy: personId,
        source: "device",
        deviceId: second.deviceId,
        receivedAt: paidAt,
      },
    ])
    .returning();
  const base = { printerId: bar!.id, nodeId: sale.nodeId, recordedAt: paidAt, personId };

  await withTransaction(fx.db, async (tx) => {
    await appendDrawerEntry(tx, {
      ...base,
      deviceId: first.deviceId,
      kind: "cash_payment",
      amount: 1000,
      billPaymentId: cash!.id,
    });
    await appendDrawerEntry(tx, {
      ...base,
      deviceId: second.deviceId,
      kind: "card_payment",
      amount: 1500,
      billPaymentId: card!.id,
    });
    await appendDrawerEntry(tx, {
      ...base,
      deviceId: second.deviceId,
      kind: "cash_refund",
      amount: -200,
      refundId,
    });
    await appendDrawerEntry(tx, { ...base, printerId: terrace!.id, kind: "cash_in", amount: 500 });
  });
  expect(
    fx.db.all(sql`
    select sequence, device_id as device, kind, amount from drawer_entries
    where printer_id = ${bar!.id} order by sequence
  `),
  ).toEqual([
    { sequence: 1, device: first.deviceId, kind: "cash_payment", amount: 1000 },
    { sequence: 2, device: second.deviceId, kind: "card_payment", amount: 1500 },
    { sequence: 3, device: second.deviceId, kind: "cash_refund", amount: -200 },
  ]);
  expect(
    fx.db.get(sql`select sequence from drawer_entries where printer_id = ${terrace!.id}`),
  ).toEqual({ sequence: 1 });
  await expect(
    withTransaction(fx.db, (tx) =>
      appendDrawerEntry(tx, {
        ...base,
        printerId: terrace!.id,
        kind: "cash_payment",
        amount: 1000,
        billPaymentId: cash!.id,
      }),
    ),
  ).rejects.toThrow(/UNIQUE constraint failed: drawer_entries.bill_payment_id/);
  await expect(
    withTransaction(fx.db, (tx) =>
      appendDrawerEntry(tx, {
        ...base,
        printerId: terrace!.id,
        kind: "cash_refund",
        amount: -200,
        refundId,
      }),
    ),
  ).rejects.toThrow(/UNIQUE constraint failed: drawer_entries.refund_id/);
});
