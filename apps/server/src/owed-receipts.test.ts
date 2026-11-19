import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceDeliveries,
  invoiceSeries,
  parties,
  printJobs,
  sales,
  unpaidDepartures,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedDevice,
  seedNode,
  seedPerson,
  seedVenue,
  seedWorkingOrder,
} from "@waitron/db/testing/seed.js";
import {
  createPrinter,
  enqueueA4PrintJob,
  enqueuePrintJob,
  MAX_DELIVERY_ATTEMPTS,
} from "@waitron/printing";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { expireInvoiceDeliveryClaims } from "./invoice-delivery.js";
import { insertCorrective } from "./testing/replacement-fixture.js";
import { owesOriginal } from "./owed-receipts.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const STAFF = "dddddddd-0000-4000-8000-000000000001";
const AT = "2026-11-19T12:00:00.000Z";

/** A recorded sale on its own bill, and a receipt printer to print it on. */
async function issued(): Promise<{
  saleId: string;
  billId: string;
  partyId: string;
  printerId: string;
}> {
  await seedPerson(suite.db, { id: STAFF });
  await seedVenue(suite.db, { name: "Bar", invoiceLocales: ["es-ES"] });
  const nodeId = await seedNode(suite.db);
  const { deviceId } = await seedDevice(suite.db);
  return withTransaction(suite.db, async (tx) => {
    const [series] = await tx
      .insert(invoiceSeries)
      .values({ nodeId, code: "F", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    const [party] = await tx.insert(parties).values({ openedBy: STAFF }).returning();
    const bill = await seedWorkingOrder(tx, {
      source: "dashboard",
      deviceId: null,
      nodeId,
      orderNumber: 1,
      status: "placed",
      openedAt: AT,
      partyId: party!.id,
    });
    const [sale] = await tx
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: AT,
        issuedOffsetMinutes: 60,
        total: 150,
        vatBreakdown: [],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
        workingOrderId: bill.id,
      })
      .returning({ id: sales.id });
    const printer = await createPrinter(tx, {
      name: "Recibos",
      transport: "network_tcp",
      host: "recibos.test",
    });
    return { saleId: sale!.id, billId: bill.id, partyId: party!.id, printerId: printer.id };
  });
}

async function receiptJob(
  saleId: string,
  printerId: string,
  set: Partial<typeof printJobs.$inferInsert> = {},
  receiptCopy = false,
): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const { jobId } = await enqueuePrintJob(tx, printerId, new Uint8Array([27, 64]), "document", {
      saleId,
      receiptCopy,
    });
    if (Object.keys(set).length > 0)
      await tx.update(printJobs).set(set).where(eq(printJobs.id, jobId));
    return jobId;
  });
}

async function delivery(
  saleId: string,
  values: Pick<typeof invoiceDeliveries.$inferInsert, "medium" | "status"> &
    Partial<typeof invoiceDeliveries.$inferInsert>,
  generation = 1,
): Promise<void> {
  await suite.db.insert(invoiceDeliveries).values({
    saleId,
    requestKey: randomUUID(),
    designation: "original",
    generation,
    personId: STAFF,
    ...(values.medium === "email" ? { recipient: "customer@example.test" } : {}),
    ...values,
  });
}

const owes = (saleId: string) => withTransaction(suite.db, (tx) => owesOriginal(tx, saleId));

const GIVEN_UP = {
  status: "failed",
  attempts: MAX_DELIVERY_ATTEMPTS,
  lastError: "refused",
} as const;

describe("owesOriginal", () => {
  it("owes a sale nothing has printed or sent", async () => {
    const { saleId } = await issued();
    expect(await owes(saleId)).toBe(true);
  });

  it("owes a sale whose original email failed", async () => {
    const { saleId } = await issued();
    await delivery(saleId, { medium: "email", status: "failed", failureCode: "transport_failed" });
    expect(await owes(saleId)).toBe(true);
  });

  it("owes a sale whose plain original print gave up", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, GIVEN_UP);
    expect(await owes(saleId)).toBe(true);
  });

  it("owes a full invoice whose tracked receipt original gave up", async () => {
    const { saleId, printerId } = await issued();
    const jobId = await receiptJob(saleId, printerId, GIVEN_UP);
    await delivery(saleId, {
      medium: "receipt",
      status: "failed",
      printJobId: jobId,
      printerId,
      failureCode: "printer_refused",
    });
    expect(await owes(saleId)).toBe(true);
  });

  it.each([false, true])(
    "owes nothing for a full invoice's tracked receipt that may have printed (restart: %s)",
    async (restart) => {
      const { saleId, printerId } = await issued();
      const claimedAt = "2026-11-19T11:00:00.000Z";
      const jobId = await receiptJob(saleId, printerId, {
        status: "printing",
        attempts: 1,
        claimedAt,
      });
      await delivery(saleId, {
        medium: "receipt",
        status: "sending",
        printJobId: jobId,
        printerId,
      });
      expect(
        await withTransaction(suite.db, (tx) =>
          expireInvoiceDeliveryClaims(tx, new Date("2026-11-19T12:00:00.000Z"), restart),
        ),
      ).toBe(1);
      const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
      expect(job).toMatchObject({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });
      expect(await owes(saleId)).toBe(false);
    },
  );

  it("does not take an A4 page's job for a receipt original", async () => {
    const { saleId } = await issued();
    await withTransaction(suite.db, async (tx) => {
      const office = await insertA4Printer(tx);
      const { jobId } = await enqueueA4PrintJob(tx, office, saleId, AT);
      await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, jobId));
    });
    expect(await owes(saleId)).toBe(true);
  });

  it("still owes a sale whose only printed receipt is a copy", async () => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, GIVEN_UP);
    await receiptJob(saleId, printerId, { status: "done" }, true);
    expect(await owes(saleId)).toBe(true);
  });

  it.each([
    ["done", { status: "done" }],
    ["queued", {}],
    ["printing", { status: "printing", attempts: 1 }],
    ["failed with attempts left", { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS - 1 }],
  ] as const)("owes nothing while an original print is %s", async (_, set) => {
    const { saleId, printerId } = await issued();
    await receiptJob(saleId, printerId, set);
    expect(await owes(saleId)).toBe(false);
  });

  it("owes nothing while a resend of a given-up original is still trying", async () => {
    const { saleId, printerId } = await issued();
    const first = await receiptJob(saleId, printerId, GIVEN_UP);
    await receiptJob(saleId, printerId, { resendOf: first });
    expect(await owes(saleId)).toBe(false);
  });

  it.each(
    (["email", "a4"] as const).flatMap((medium) =>
      (["queued", "sending", "sent", "unknown"] as const).map(
        (status) => [medium, status] as const,
      ),
    ),
  )("owes nothing once an %s original is %s", async (medium, status) => {
    const { saleId } = await issued();
    await delivery(saleId, { medium, status });
    expect(await owes(saleId)).toBe(false);
  });

  it.each(["unknown", "sent"] as const)(
    "owes nothing for an email the mail server accepted late, stored as %s",
    async (status) => {
      const { saleId } = await issued();
      await delivery(saleId, {
        medium: "email",
        status,
        reportedOutcome: "sent",
        reportedAt: AT,
      });
      expect(await owes(saleId)).toBe(false);
    },
  );

  it("owes nothing to a corrective", async () => {
    const { saleId } = await issued();
    const corrective = await withTransaction(suite.db, (tx) =>
      insertCorrective(tx, saleId, { total: "-1.50" }),
    );
    expect(await owes(corrective)).toBe(false);
  });

  it("owes nothing to a bill whose party left without paying", async () => {
    const { saleId, billId, partyId } = await issued();
    const [bill] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    await suite.db.insert(unpaidDepartures).values({
      partyId,
      workingOrderId: billId,
      saleId,
      amount: bill!.total,
      reason: "Left without paying",
      recordedBy: STAFF,
      authorizedBy: STAFF,
      source: "device",
      deviceId: bill!.deviceId,
    });
    expect(await owes(saleId)).toBe(false);
  });
});
