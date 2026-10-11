import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  printers,
  devices,
  diningTables,
  printJobs,
  sales,
  saleLines,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createDepartment,
  createServiceZone,
  deleteDepartment,
  departmentReceipts,
  departments,
  departmentSalePolicies,
  departmentTransferRequests,
  orderServiceContexts,
  workingLineContexts,
  saleReceiptHeaders,
  zoneServicePolicies,
  readDepartmentTransfer,
  listSentDepartmentTransfers,
} from "@waitron/venue-service";
import { setupPartyVenue, counterOrder, pay } from "./testing/party-venue.js";
import { moduleCoreServices } from "./parties.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { enqueueReceiptReprint } from "./receipt-print.js";
import { readSettledTicket } from "./till-sale.js";
import { previewPrintJob } from "./print-job-preview.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { readOrderDetail } from "./orders-list.js";
import { readReceiptOrder } from "./receipt-order.js";
import { orderWatchZones } from "./watch-zones.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("deleted department reprints its original receipt configuration and frozen header/line names", async () => {
  const venue = await setupPartyVenue(suite.db);
  const run = <T>(fn: (tx: import("@waitron/db").Transaction) => Promise<T>) =>
    withTransaction(suite.db, fn);
  const [policy] = await run((tx) =>
    tx
      .select()
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, venue.counter.zoneId)),
  );
  const departmentId = policy!.departmentId;
  const [original] = await run((tx) =>
    tx.select().from(departments).where(eq(departments.id, departmentId)),
  );
  const survivorId = await run(async (tx) => {
    const survivor = await createDepartment(tx, venue.cfg, { name: "Survivor" });
    await tx
      .update(departments)
      .set({ tradingName: "Frozen trading brand" })
      .where(eq(departments.id, departmentId));
    await tx
      .update(departmentSalePolicies)
      .set({ printTradingName: true })
      .where(eq(departmentSalePolicies.departmentId, departmentId));
    await tx
      .insert(departmentReceipts)
      .values({
        departmentId,
        receipt: { headerSubtitle: { "es-ES": "Retained service subtitle" }, phone: "911111111" },
      });
    return survivor.id;
  });
  const billId = await counterOrder(venue, "Paella");
  await pay(venue, billId, "20.00");
  const [sale] = await run((tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId)));
  const ticket = await run((tx) => readSettledTicket(venue.backend, tx, venue.cfg, billId));
  const printer = await run(
    async (tx) =>
      (
        await tx
          .insert(printers)
          .values({
            locationId: venue.cfg.locationId,
            name: "History",
            transport: "network_tcp",
            host: "192.0.2.1",
          })
          .returning()
      )[0]!.id,
  );
  await run((tx) =>
    tx
      .update(devices)
      .set({ receiptPrinterId: printer })
      .where(eq(devices.id, venue.cfg.origin.deviceId)),
  );
  await run((tx) => enqueueReceiptReprint(tx, venue.cfg, ticket, sale!.id));
  const beforePrint = (await run((tx) => tx.select().from(printJobs)))[0]!;
  const beforeText = decodeTicket(beforePrint.payload);
  expect(beforeText).toContain("Retained service subtitle");
  expect(beforeText).toContain("Frozen trading brand");
  expect(beforeText).toContain("Paella valenciana");
  const before = await run(async (tx) => ({
    sales: await tx.select().from(sales),
    lines: await tx.select().from(saleLines),
    orders: await tx.select().from(workingOrders),
    contexts: await tx.select().from(orderServiceContexts),
    lineContexts: await tx.select().from(workingLineContexts),
    headers: await tx.select().from(saleReceiptHeaders),
    receipt: await tx.select().from(departmentReceipts),
    fiscal: (await tx.execute(sql`select * from registros_facturacion order by id`)).rows,
  }));
  const transfer = await run(async (tx) => {
    const [row] = await tx
      .insert(departmentTransferRequests)
      .values({
        tabId: billId,
        sourceDepartmentId: departmentId,
        destinationDepartmentId: survivorId,
        destinationZoneId: venue.counter.zoneId,
        senderId: venue.operator.personId,
        status: "declined",
        reason: "History retained",
        resolvedAt: "2026-10-11T12:00:00Z",
      })
      .returning();
    return row!;
  });
  const sent = await run((tx) =>
    listSentDepartmentTransfers(tx, venue.cfg, billId, {
      departmentId,
      personId: venue.operator.personId,
    }),
  );
  expect(sent[0]!.summary.sourceDepartmentName).toBe(original!.name);
  const detail = await run((tx) => readOrderDetail(tx, billId, "all"));
  const grouping = await run((tx) => readReceiptOrder(tx, venue.cfg, billId));
  await run((tx) =>
    deleteDepartment(
      tx,
      venue.cfg,
      moduleCoreServices(venue.cfg, enabledTableRemovals(ALL_MODULES)).floorDeletion,
      departmentId,
      new Date("2026-10-11T12:00:00Z"),
    ),
  );
  await run(async (tx) => {
    const reused = await createDepartment(tx, venue.cfg, {
      name: original!.name,
      tradingName: "Replacement brand",
    });
    await createServiceZone(tx, venue.cfg, { name: "counter", departmentId: reused.id });
    await tx
      .insert(departmentReceipts)
      .values({
        departmentId: reused.id,
        receipt: { headerSubtitle: { "es-ES": "Replacement subtitle" } },
      });
  });
  await run((tx) => enqueueReceiptReprint(tx, venue.cfg, ticket, sale!.id));
  const afterPrint = (await run((tx) => tx.select().from(printJobs)))[1]!;
  expect(decodeTicket(afterPrint.payload)).toBe(beforeText);
  expect(previewPrintJob(afterPrint.payload)).toEqual(previewPrintJob(beforePrint.payload));
  expect(await run((tx) => readReceiptOrder(tx, venue.cfg, billId))).toEqual(grouping);
  const afterDetail = await run((tx) => readOrderDetail(tx, billId, "all"));
  expect(afterDetail.row).toEqual(detail.row);
  expect(afterDetail.lines).toEqual(detail.lines);
  expect(
    await run((tx) =>
      readDepartmentTransfer(tx, venue.cfg, transfer.id, {
        departmentId,
        personId: venue.operator.personId,
      }),
    ),
  ).toEqual(transfer);
  expect(
    await run((tx) =>
      listSentDepartmentTransfers(tx, venue.cfg, billId, {
        departmentId,
        personId: venue.operator.personId,
      }),
    ),
  ).toEqual(sent);
  expect(
    (
      await run((tx) =>
        orderWatchZones(tx, venue.cfg, [{ id: billId, partyId: null, deliveryTableId: null }]),
      )
    ).get(billId),
  ).toBe(venue.counter.zoneId);
  const after = await run(async (tx) => ({
    sales: await tx.select().from(sales),
    lines: await tx.select().from(saleLines),
    orders: await tx.select().from(workingOrders),
    contexts: await tx.select().from(orderServiceContexts),
    lineContexts: await tx.select().from(workingLineContexts),
    headers: await tx.select().from(saleReceiptHeaders),
    receipt: await tx
      .select()
      .from(departmentReceipts)
      .where(eq(departmentReceipts.departmentId, departmentId)),
    fiscal: (await tx.execute(sql`select * from registros_facturacion order by id`)).rows,
  }));
  expect(after).toEqual(before);
  expect(await run((tx) => tx.select().from(diningTables))).toEqual([]);
});
