import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { printJobs, saleLines, sales, tenders, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { enqueueReceiptCopy } from "./receipt-print.js";
import { recordTillSale } from "./till-sale.js";
import { readOrderKitchenNotes, setOrderKitchenNote } from "./order-kitchen-note.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { inTx, OPERATOR, setupPartyVenue } from "./testing/party-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

describe("whole-order instructions and issued customer documents", () => {
  it("leaves commercial rows unchanged and keeps both note versions off customer receipts", async () => {
    const v = await setupPartyVenue(suite.db);
    const workingOrderId = randomUUID();
    const ticket = await recordTillSale(
      { db: v.db, backend: v.backend, clock: v.clock },
      v.cfg,
      {
        workingOrderId,
        zoneId: v.counter.zoneId,
        lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
        tender: { method: "cash", amount: "12.00" },
        kitchenNote: "KITCHEN-ONLY original instruction",
      },
      v.operator,
    );
    const before = {
      sales: await v.db.select().from(sales),
      saleLines: await v.db.select().from(saleLines),
      tenders: await v.db.select().from(tenders),
      orderLines: await v.db.select().from(workingOrderLines),
    };
    expect(before.sales).toHaveLength(1);
    const p = await inTx(v, (tx) =>
      createPrinter(
        tx,
        { locationId: v.cfg.locationId },
        { name: "Receipts", transport: "cloud_poll", pollId: randomUUID() },
      ),
    );
    const receipt = async () => {
      const queued = await inTx(v, (tx) =>
        enqueueReceiptCopy(tx, v.cfg, ticket, before.sales[0]!.id, {
          id: p.id,
          paperWidth: "80mm",
          resolution: "203dpi",
        }),
      );
      expect(queued).toBeDefined();
      const [job] = await v.db.select().from(printJobs).where(eq(printJobs.id, queued!.jobId));
      const text = decodeTicket(job!.payload);
      expect(text).toContain("Hamburguesa de la casa");
      expect(text).toContain("12,00");
      expect(text).not.toContain("KITCHEN-ONLY");
      return job!;
    };
    const first = await receipt();
    const current = await inTx(v, async (tx) =>
      (await readOrderKitchenNotes(tx, [workingOrderId])).get(workingOrderId)!,
    );
    await inTx(v, (tx) =>
      setOrderKitchenNote(
        tx,
        v.db,
        v.cfg,
        { workingOrderId },
        {
          submissionId: randomUUID(),
          expectedNoteRevision: current.revision,
          expectedOwnerRevision: current.ownerRevision,
          note: "KITCHEN-ONLY updated instruction",
          operatorId: OPERATOR,
          deviceId: v.cfg.origin.deviceId,
        },
      ),
    );
    const second = await receipt();
    expect(second.payload).toEqual(first.payload);
    expect(await v.db.select().from(sales)).toEqual(before.sales);
    expect(await v.db.select().from(saleLines)).toEqual(before.saleLines);
    expect(await v.db.select().from(tenders)).toEqual(before.tenders);
    expect(await v.db.select().from(workingOrderLines)).toEqual(before.orderLines);
    expect((await v.db.select().from(printJobs).where(eq(printJobs.id, first.id)))[0]).toEqual(
      first,
    );
  });
});
