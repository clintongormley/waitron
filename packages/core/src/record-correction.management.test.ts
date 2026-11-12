import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS, invoiceSeries, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, persons, startManagementSession } from "@waitron/identity";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import { seedBareSale, seedRectificativeSeries, seedTenant } from "../test/fixtures.js";
import { recordCorrection, type RecordCorrectionInput } from "./record-correction.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
});
let personId: string;
let token: string;
let input: Omit<RecordCorrectionInput, "authz">;
let backend: FakeFiscalBackend;
beforeEach(async () => {
  backend = new FakeFiscalBackend(suite.db);
  const seed = await seedTenant(suite.db);
  const originalId = await seedBareSale(suite.db, seed);
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
      displayName: "Administrator",
      role: "admin",
      pinHash: hashPin("2468"),
    });
    personId = person!.id;
    token = (await startManagementSession(tx, { personId })).token;
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
function apply() {
  return withTransaction(suite.db, (tx) =>
    recordCorrection(tx, backend, {
      ...input,
      authz: { managementSessionId: token },
    }),
  );
}
async function snapshot() {
  return {
    sales: await suite.db.select().from(sales),
    series: await suite.db.select().from(invoiceSeries),
  };
}
// Removing management authorization must either refuse this operation or lose its authorizer.
it("records the management authorizer without requiring a till session", async () => {
  const result = await apply();
  const [row] = await suite.db.select().from(sales).where(eq(sales.id, result.saleId));
  expect(row).toMatchObject({
    authorizedBy: personId,
    correctsSaleId: input.correctsSaleId,
    total: -605,
    invoiceNumber: 1,
  });
});
it.each(["staff", "manager"] as const)(
  "checks sale.rectify for a live %s management session",
  async (role) => {
    await setBuiltInRoleForTest(suite.db, personId, role);
    const before = await snapshot();
    if (role === "staff") {
      await expect(apply()).rejects.toMatchObject({ code: "authorization.not_permitted" });
      expect(await snapshot()).toEqual(before);
    } else {
      const result = await apply();
      expect(
        (await suite.db.select().from(sales).where(eq(sales.id, result.saleId)))[0]?.authorizedBy,
      ).toBe(personId);
    }
  },
);
it("refuses an invalid management token without allocating a number", async () => {
  token = "invalid-token";
  const before = await snapshot();
  await expect(apply()).rejects.toMatchObject({ code: "management_session.required" });
  expect(await snapshot()).toEqual(before);
});
it("rechecks a suspended manager before writing", async () => {
  await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, personId));
  const before = await snapshot();
  await expect(apply()).rejects.toMatchObject({ code: "person.suspended" });
  expect(await snapshot()).toEqual(before);
});
