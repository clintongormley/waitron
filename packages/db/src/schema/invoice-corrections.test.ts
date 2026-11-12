import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { refusalOn, triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedNode, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { invoiceCorrectionRefunds } from "./invoice-correction-refunds.js";
import { invoiceCorrections } from "./invoice-corrections.js";
import { sales, tenders } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { tenderRefunds } from "./tender-refunds.js";

const AT = "2026-11-11T09:00:00.000Z";
const GHOST = "bbbbbbbb-0000-4000-8000-0000000000ff";
const GUARD = "invoice correction cannot make that change";

describe("invoice_corrections and invoice_correction_refunds", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let db: Database;
  let deviceId: string;
  let nodeId: string;
  let originalSaleId: string;
  let correctiveSaleId: string;
  let tenderRefundId: string;

  beforeEach(async () => {
    db = suite.db;
    await seedVenue(db, { name: "Fix", invoiceLocales: ["en"], operationDescription: "Meals" });
    nodeId = await seedNode(db);
    ({ deviceId } = await seedDevice(db));
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "IC", purpose: "standard" })
      .returning();
    const sale = (invoiceNumber: number, total: number, correctsSaleId?: string) =>
      db
        .insert(sales)
        .values({
          source: "device",
          deviceId,
          nodeId,
          seriesId: series!.id,
          invoiceNumber,
          issuedAt: AT,
          issuedOffsetMinutes: 0,
          total,
          vatBreakdown: [],
          locale: "en",
          invoiceLocales: ["en"],
          fiscalBackend: "none",
          fiscalState: "not_applicable",
          correctsSaleId,
        })
        .returning();
    const [original] = await sale(1, 1000);
    const [corrective] = await sale(2, -400, original!.id);
    const [tender] = await db
      .insert(tenders)
      .values({ saleId: original!.id, method: "cash", amount: 1000, settledAt: AT })
      .returning();
    const [refund] = await db
      .insert(tenderRefunds)
      .values({
        saleId: original!.id,
        tenderId: tender!.id,
        submissionId: randomUUID(),
        fingerprint: "leg",
        appliedAmount: 400,
        reason: "Wrong dish",
        requestedBy: GHOST,
        authorizedBy: GHOST,
        source: "device",
        deviceId,
        nodeId,
        method: "cash",
        state: "completed",
        completedAt: AT,
      })
      .returning();
    originalSaleId = original!.id;
    correctiveSaleId = corrective!.id;
    tenderRefundId = refund!.id;
  });

  const open = (values: Partial<typeof invoiceCorrections.$inferInsert> = {}) =>
    db
      .insert(invoiceCorrections)
      .values({
        originalSaleId,
        submissionId: randomUUID(),
        fingerprint: "f",
        gross: 400,
        lineIds: null,
        reason: "Wrong dish",
        requestedBy: GHOST,
        authorizedBy: GHOST,
        viaOverride: false,
        source: "device",
        deviceId,
        nodeId,
        state: "open",
        ...values,
      })
      .returning();

  const link = (invoiceCorrectionId: string, values: { tenderRefundId?: string } = {}) =>
    db
      .insert(invoiceCorrectionRefunds)
      .values({ invoiceCorrectionId, tenderRefundId, requestId: randomUUID(), ...values })
      .returning();

  it("keeps an open correction and its leg", async () => {
    const [correction] = await open({ lineIds: ["l1"] });
    const [leg] = await link(correction!.id);
    const [read] = await db
      .select()
      .from(invoiceCorrections)
      .where(eq(invoiceCorrections.id, correction!.id));
    expect(read).toMatchObject({
      originalSaleId,
      gross: 400,
      lineIds: ["l1"],
      state: "open",
      correctiveSaleId: null,
      endedAt: null,
      endedBy: null,
    });
    const [readLeg] = await db
      .select()
      .from(invoiceCorrectionRefunds)
      .where(eq(invoiceCorrectionRefunds.id, leg!.id));
    expect(readLeg).toMatchObject({ invoiceCorrectionId: correction!.id, tenderRefundId });
    expect(Date.parse(readLeg!.createdAt)).not.toBeNaN();
  });

  it("refuses a correction or a leg naming a missing sale, correction or refund", async () => {
    const original = await captureError(() => open({ originalSaleId: GHOST }));
    expect(isRefusal(original, FOREIGN_KEY_VIOLATION)).toBe(true);
    const corrective = await captureError(() =>
      open({ state: "filed", correctiveSaleId: GHOST, endedAt: AT }),
    );
    expect(isRefusal(corrective, FOREIGN_KEY_VIOLATION)).toBe(true);
    const correction = await captureError(() => link(GHOST));
    expect(isRefusal(correction, FOREIGN_KEY_VIOLATION)).toBe(true);
    const [written] = await open();
    const refund = await captureError(() => link(written!.id, { tenderRefundId: GHOST }));
    expect(isRefusal(refund, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("refuses a second open correction for one sale, and allows one once the first is filed", async () => {
    const [first] = await open();
    const second = await captureError(() => open());
    expect(
      refusalOn(second, UNIQUE_VIOLATION, {
        table: "invoice_corrections",
        columns: ["original_sale_id"],
      }),
    ).toBe(true);
    await db
      .update(invoiceCorrections)
      .set({ state: "filed", correctiveSaleId, endedAt: AT })
      .where(eq(invoiceCorrections.id, first!.id));
    const [next] = await open();
    expect(next!.state).toBe("open");
  });

  it("moves an open correction once, and refuses every other change and every delete", async () => {
    const [written] = await open();
    const filedWithoutSale = await captureError(() =>
      db.run(
        sql`update invoice_corrections set state = 'filed', ended_at = ${AT} where id = ${written!.id}`,
      ),
    );
    expect(isRefusal(filedWithoutSale, CHECK_VIOLATION)).toBe(true);
    await db
      .update(invoiceCorrections)
      .set({ state: "discarded", endedAt: AT, endedBy: GHOST })
      .where(eq(invoiceCorrections.id, written!.id));
    const reopen = await captureError(() =>
      db.run(
        sql`update invoice_corrections set state = 'open', ended_at = null, ended_by = null where id = ${written!.id}`,
      ),
    );
    expect(triggerRaised(reopen, GUARD)).toBe(true);
    const gross = await captureError(() =>
      db.run(sql`update invoice_corrections set gross = 500 where id = ${written!.id}`),
    );
    expect(triggerRaised(gross, GUARD)).toBe(true);
    const remove = await captureError(() =>
      db.run(sql`delete from invoice_corrections where id = ${written!.id}`),
    );
    expect(triggerRaised(remove, "an invoice correction is never deleted")).toBe(true);
  });

  it("refuses a second link for one refund, and update, delete or insert-or-replace of a link", async () => {
    const [correction] = await open();
    const [written] = await link(correction!.id);
    const second = await captureError(() => link(correction!.id));
    expect(
      refusalOn(second, UNIQUE_VIOLATION, {
        table: "invoice_correction_refunds",
        columns: ["tender_refund_id"],
      }),
    ).toBe(true);
    const raised = "invoice_correction_refunds is append-only";
    const update = await captureError(() =>
      db.run(
        sql`update invoice_correction_refunds set request_id = 'other' where id = ${written!.id}`,
      ),
    );
    expect(triggerRaised(update, raised)).toBe(true);
    const remove = await captureError(() =>
      db.run(sql`delete from invoice_correction_refunds where id = ${written!.id}`),
    );
    expect(triggerRaised(remove, raised)).toBe(true);
    const replace = await captureError(() =>
      db.run(
        sql`insert or replace into invoice_correction_refunds select * from invoice_correction_refunds where id = ${written!.id}`,
      ),
    );
    expect(triggerRaised(replace, raised)).toBe(true);
  });
});
