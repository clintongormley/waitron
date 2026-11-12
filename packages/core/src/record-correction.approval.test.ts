import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceCorrections,
  invoiceSeries,
  managementSessions,
  sales,
  sessions,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, persons } from "@waitron/identity";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { decimal, deviceOrigin, type SaleId } from "@waitron/shared";
import { seedBareSale, seedRectificativeSeries, seedTenant } from "../test/fixtures.js";
import { recordCorrection, type RecordCorrectionInput } from "./record-correction.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
});
let approverId: string;
let otherSaleId: SaleId;
let nodeId: string;
let deviceId: string;
let input: Omit<RecordCorrectionInput, "authz">;
let backend: FakeFiscalBackend;
beforeEach(async () => {
  backend = new FakeFiscalBackend(suite.db);
  const seed = await seedTenant(suite.db);
  nodeId = seed.nodeId;
  deviceId = seed.deviceId;
  const originalId = await seedBareSale(suite.db, seed);
  otherSaleId = await seedBareSale(suite.db, seed, { invoiceNumber: 2 });
  const seriesId = await seedRectificativeSeries(suite.db, seed.nodeId);
  await withTransaction(suite.db, async (tx) => {
    await backend.registerNode(tx, seed.nodeId);
    await backend.recordSale(tx, {
      origin: deviceOrigin(seed.deviceId),
      nodeId: seed.nodeId,
      saleId: originalId,
      seriesId: seed.seriesId,
      seriesCode: "A",
      invoiceNumber: 1,
      issuedAt: new Date("2026-03-01T12:00:00Z"),
      offsetMinutes: 0,
      descriptionOfOperation: "Food and drink",
      total: decimal("65.00"),
      vatBreakdown: [],
      counterparty: null,
    });
    const [person] = await seedPersons(tx, {
      displayName: "Approving manager",
      role: "manager",
      pinHash: hashPin("2468"),
    });
    approverId = person!.id;
  });
  input = {
    origin: deviceOrigin(seed.deviceId),
    operationDescription: "Correct an invoice item",
    nodeId: seed.nodeId,
    seriesId,
    correctsSaleId: originalId,
    total: "-6.05",
    lines: [
      {
        lineNo: 1,
        name: "Coffee",
        descriptions: { "es-ES": "Coffee" },
        quantity: "-1",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "-5.00",
      },
    ],
    clock: {
      now: () => ({
        instant: new Date("2026-03-01T13:00:00Z"),
        offsetMinutes: 60,
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      }),
      anchor: () => {
        throw new Error("Unused clock anchor");
      },
      currentAnchor: () => null,
    },
  };
});
async function openCorrection(values: { originalSaleId?: SaleId; gross?: number } = {}) {
  const [row] = await suite.db
    .insert(invoiceCorrections)
    .values({
      originalSaleId: values.originalSaleId ?? input.correctsSaleId,
      submissionId: crypto.randomUUID(),
      fingerprint: "fingerprint",
      gross: values.gross ?? 605,
      reason: "Wrong item",
      requestedBy: approverId,
      authorizedBy: approverId,
      viaOverride: false,
      source: "device",
      deviceId,
      nodeId,
      state: "open",
    })
    .returning({ id: invoiceCorrections.id });
  return row!.id;
}
function apply(invoiceCorrectionId: string) {
  return withTransaction(suite.db, (tx) =>
    recordCorrection(tx, backend, { ...input, authz: { invoiceCorrectionId } }),
  );
}
async function snapshot() {
  return {
    sales: await suite.db.select().from(sales),
    series: await suite.db.select().from(invoiceSeries),
  };
}
async function expectRefused(invoiceCorrectionId: string, refusal: object) {
  const before = await snapshot();
  await expect(apply(invoiceCorrectionId)).rejects.toMatchObject(refusal);
  expect(await snapshot()).toEqual(before);
}
function approvalInvalid(invoiceCorrectionId: string, reason: string) {
  return {
    code: "sale.correction_approval_invalid",
    params: { invoiceCorrectionId, reason },
  };
}

it("files on an open correction's approval with no session, recording its approver", async () => {
  const correctionId = await openCorrection();
  expect(await suite.db.select().from(sessions)).toEqual([]);
  expect(await suite.db.select().from(managementSessions)).toEqual([]);
  const result = await apply(correctionId);
  const [row] = await suite.db.select().from(sales).where(eq(sales.id, result.saleId));
  expect(row).toMatchObject({
    authorizedBy: approverId,
    correctsSaleId: input.correctsSaleId,
    total: -605,
    invoiceNumber: 1,
  });
});
it("refuses a correction row of another sale", async () => {
  const correctionId = await openCorrection({ originalSaleId: otherSaleId });
  await expectRefused(correctionId, approvalInvalid(correctionId, "other_sale"));
});
it("refuses an amount over the correction's gross", async () => {
  const correctionId = await openCorrection({ gross: 604 });
  await expectRefused(correctionId, approvalInvalid(correctionId, "over_amount"));
  await suite.db
    .update(invoiceCorrections)
    .set({
      state: "discarded",
      endedAt: new Date("2026-03-01T12:30:00Z").toISOString(),
      endedBy: approverId,
    })
    .where(eq(invoiceCorrections.id, correctionId));
  const exact = await openCorrection({ gross: 605 });
  const result = await apply(exact);
  expect((await suite.db.select().from(sales).where(eq(sales.id, result.saleId)))[0]).toMatchObject(
    { authorizedBy: approverId, total: -605 },
  );
});
it("refuses a correction that is not open", async () => {
  const correctionId = await openCorrection();
  await suite.db
    .update(invoiceCorrections)
    .set({
      state: "filed",
      correctiveSaleId: otherSaleId,
      endedAt: new Date("2026-03-01T12:30:00Z").toISOString(),
    })
    .where(eq(invoiceCorrections.id, correctionId));
  await expectRefused(correctionId, approvalInvalid(correctionId, "not_open"));
});
it("refuses an unknown id", async () => {
  const unknown = crypto.randomUUID();
  await expectRefused(unknown, approvalInvalid(unknown, "not_found"));
});
it("refuses an approver who no longer holds sale.rectify", async () => {
  const correctionId = await openCorrection();
  await setBuiltInRoleForTest(suite.db, approverId, "staff");
  await expectRefused(correctionId, { code: "authorization.not_permitted" });
});
it("refuses a suspended approver", async () => {
  const correctionId = await openCorrection();
  await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, approverId));
  await expectRefused(correctionId, { code: "authorization.not_permitted" });
});
