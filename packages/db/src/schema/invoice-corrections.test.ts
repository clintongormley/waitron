import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { refusalOn, triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedNode, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { invoiceCorrections } from "./invoice-corrections.js";
import { sales, tenders } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { tenderRefunds } from "./tender-refunds.js";

const AT = "2026-11-11T09:00:00.000Z";
const GHOST = "bbbbbbbb-0000-4000-8000-0000000000ff";

describe("invoice_corrections: the replay record of a cash correction", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let db: Database;
  let row: { originalSaleId: string; correctiveSaleId: string; tenderRefundId: string };

  beforeEach(async () => {
    db = suite.db;
    await seedVenue(db, { name: "Fix", invoiceLocales: ["en"], operationDescription: "Meals" });
    const nodeId = await seedNode(db);
    const { deviceId } = await seedDevice(db);
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
    row = {
      originalSaleId: original!.id,
      correctiveSaleId: corrective!.id,
      tenderRefundId: refund!.id,
    };
  });

  const insert = (values: Partial<typeof row> = {}) =>
    db
      .insert(invoiceCorrections)
      .values({ ...row, ...values, submissionId: randomUUID(), fingerprint: "f" })
      .returning();

  it("keeps a row whose sales and refund exist", async () => {
    const [written] = await insert();
    const [read] = await db
      .select()
      .from(invoiceCorrections)
      .where(eq(invoiceCorrections.id, written!.id));
    expect(read).toMatchObject({ ...row, fingerprint: "f" });
    expect(Date.parse(read!.createdAt)).not.toBeNaN();
  });

  it("refuses a row naming a missing sale or refund", async () => {
    for (const missing of ["originalSaleId", "correctiveSaleId", "tenderRefundId"] as const) {
      const error = await captureError(() => insert({ [missing]: GHOST }));
      expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    }
  });

  it("refuses a second row for one refund", async () => {
    await insert();
    const error = await captureError(() => insert());
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "invoice_corrections",
        columns: ["tender_refund_id"],
      }),
    ).toBe(true);
  });

  it("refuses update, delete and insert-or-replace", async () => {
    const [written] = await insert();
    const raised = "invoice_corrections is append-only";
    const update = await captureError(() =>
      db.run(sql`update invoice_corrections set fingerprint = 'g' where id = ${written!.id}`),
    );
    expect(triggerRaised(update, raised)).toBe(true);
    const remove = await captureError(() =>
      db.run(sql`delete from invoice_corrections where id = ${written!.id}`),
    );
    expect(triggerRaised(remove, raised)).toBe(true);
    const replace = await captureError(() =>
      db.run(
        sql`insert or replace into invoice_corrections select * from invoice_corrections where id = ${written!.id}`,
      ),
    );
    expect(triggerRaised(replace, raised)).toBe(true);
  });
});
