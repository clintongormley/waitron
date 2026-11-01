import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  invoiceSeries,
  locations,
  sales,
  tenants,
  workingOrders,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  recordSale,
  recordCorrection,
  recordSubstitution,
  recordVoid,
  type RecordSaleInput,
} from "@waitron/core";
import { prepareIssueClock, type TrustedClock } from "@waitron/fiscal";
import * as regime from "@waitron/fiscal-verifactu";
import { decodeRegistroRow } from "@waitron/fiscal-verifactu/src/registro-row.js";
import { loginWithPin } from "@waitron/identity";
import { seriesId, workingOrderId, type SaleId } from "@waitron/shared";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";

const AT = "2026-10-14T23:30:00.000Z";
const recipient = { taxId: "B12345674", legalName: "Business customer", countryCode: "ES" };
let v: BillVenue;
let sessionId: string;
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
beforeEach(async () => {
  v = await provisionBillVenue(suite.db);
  await v.db.update(tenants).set({ taxpayerDomicile: "1 Registered Street" });
  sessionId = (
    await withTransaction(v.db, (tx) =>
      loginWithPin(tx, { deviceId: v.deviceId, personId: v.adminId, pin: "1234" }),
    )
  ).id;
});
function source(instant = AT): TrustedClock {
  return {
    ...v.clock,
    now: () => ({ ...v.clock.now(), instant: new Date(instant), offsetMinutes: 0 }),
  };
}
async function issuingClock(tx: Transaction, instant = AT) {
  return prepareIssueClock(tx, v.cfg, source(instant));
}
function input(clock: TrustedClock, overrides: Partial<RecordSaleInput> = {}): RecordSaleInput {
  return {
    origin: v.cfg.origin,
    nodeId: v.cfg.nodeId,
    seriesId: v.seriesId,
    locale: "en-GB",
    invoiceLocales: ["en-GB"],
    operationDescription: "Restaurant service",
    total: "12.10",
    lines: [
      {
        lineNo: 1,
        name: "Staff dish",
        descriptions: { "en-GB": "Customer dish" },
        quantity: "1",
        unitPrice: "10.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
    ],
    settlement: { kind: "deferred" },
    clock,
    ...overrides,
  };
}
async function addSeries(purpose: "full" | "rectificative") {
  const [s] = await v.db
    .insert(invoiceSeries)
    .values({ nodeId: v.cfg.nodeId, code: purpose === "full" ? "FULL" : "CREDIT", purpose })
    .returning();
  return seriesId(s!.id);
}
function records(id: string) {
  return v.db
    .all<regime.RegistroRow>(
      sql`select * from registros_facturacion where sale_id = ${id} order by secuencia`,
    )
    .map((r) => regime.fromRegistroRow(decodeRegistroRow(r)));
}
function snapshot() {
  return Object.fromEntries(
    [
      "sales",
      "sale_lines",
      "sale_voids",
      "sale_substitutions",
      "invoice_series",
      "registros_facturacion",
      "cadenas",
      "envios",
      "tenders",
      "sale_settlements",
    ].map((name) => [name, v.db.all(sql`select * from ${sql.identifier(name)} order by rowid`)]),
  );
}
async function original(instant = AT) {
  return withTransaction(v.db, (tx) => recordSale(tx, v.backend, input(source(instant))));
}
async function voidClock(tx: Transaction, id: SaleId) {
  return regime.prepareFiscalVoidClock(tx, id, source());
}

describe("core-only callers prepare the saved writing zone", () => {
  it.each(["deferred", "immediate"] as const)(
    "dates an F1 %s invoice without changing operation-date selection",
    async (kind) => {
      const full = await addSeries("full");
      const issued = await withTransaction(v.db, async (tx) =>
        recordSale(
          tx,
          v.backend,
          input(await issuingClock(tx), {
            seriesId: full,
            counterparty: recipient,
            recipientAddress: "1 Customer Street",
            settlement:
              kind === "deferred"
                ? { kind }
                : {
                    kind,
                    tenders: [
                      {
                        method: "cash",
                        amount: "12.10",
                        tipAmount: "0.00",
                        settledAt: new Date(AT),
                      },
                    ],
                  },
          }),
        ),
      );
      const [row] = await v.db.select().from(sales).where(eq(sales.id, issued.saleId));
      expect(row).toMatchObject({
        issuedAt: AT,
        issuedOffsetMinutes: 120,
        total: 1210,
        operationDate: "2026-10-15",
        counterpartyAddress: "1 Customer Street",
      });
      expect(records(issued.saleId)[0]).toMatchObject({
        TipoFactura: "F1",
        IDFactura: { FechaExpedicionFactura: "15-10-2026" },
        FechaHoraHusoGenRegistro: "2026-10-15T01:30:00+02:00",
      });
      expect(records(issued.saleId)[0]).not.toHaveProperty("FechaOperacion");
      expect(
        v.db.all(sql`select * from sale_settlements where sale_id = ${issued.saleId}`),
      ).toHaveLength(kind === "deferred" ? 0 : 1);
    },
  );
  it("keeps F1's earlier bill-opening operation date out of the filed issue record", async () => {
    const full = await addSeries("full");
    const [order] = await v.db
      .insert(workingOrders)
      .values({
        ...v.cfg.origin,
        nodeId: v.cfg.nodeId,
        locationId: v.cfg.locationId,
        orderNumber: 100,
        openedAt: "2026-10-13T23:30:00.000Z",
      })
      .returning();
    const issued = await withTransaction(v.db, async (tx) =>
      recordSale(
        tx,
        v.backend,
        input(await issuingClock(tx), {
          seriesId: full,
          counterparty: recipient,
          recipientAddress: "1 Customer Street",
          workingOrderId: workingOrderId(order!.id),
        }),
      ),
    );
    const [saved] = await v.db.select().from(sales).where(eq(sales.id, issued.saleId));
    expect(saved).toMatchObject({
      operationDate: "2026-10-14",
      issuedAt: AT,
      issuedOffsetMinutes: 120,
    });
    expect(records(issued.saleId)[0]).toMatchObject({
      IDFactura: { FechaExpedicionFactura: "15-10-2026" },
      FechaHoraHusoGenRegistro: "2026-10-15T01:30:00+02:00",
    });
    expect(records(issued.saleId)[0]).not.toHaveProperty("FechaOperacion");
  });
  it("dates generic R5 now and retains the old offset-zero original identity", async () => {
    const old = await original();
    const before = records(old.saleId);
    const credit = await addSeries("rectificative");
    const issued = await withTransaction(v.db, async (tx) =>
      recordCorrection(tx, v.backend, {
        origin: v.cfg.origin,
        nodeId: v.cfg.nodeId,
        seriesId: credit,
        correctsSaleId: old.saleId,
        total: "-12.10",
        lines: [{ ...input(source()).lines[0]!, quantity: "-1", lineTotal: "-10.00" }],
        clock: await issuingClock(tx),
        authz: { sessionId },
      }),
    );
    expect(records(issued.saleId)[0]).toMatchObject({
      TipoFactura: "R5",
      IDFactura: { FechaExpedicionFactura: "15-10-2026" },
      FacturasRectificadas: { IDFacturaRectificada: [before[0]!.IDFactura] },
      FechaHoraHusoGenRegistro: "2026-10-15T01:30:00+02:00",
      Encadenamiento: {
        RegistroAnterior: { Huella: before[0]!.Huella, FechaExpedicionFactura: "14-10-2026" },
      },
    });
    expect(records(old.saleId)).toEqual(before);
  });
  it("an F3 retains two original days and the actual predecessor hash", async () => {
    const first = await original("2026-10-13T23:30:00.000Z");
    const second = await original();
    const originals = [records(first.saleId)[0]!, records(second.saleId)[0]!];
    expect(originals.map((r) => r.IDFactura)).toMatchObject([
      { FechaExpedicionFactura: "13-10-2026" },
      { FechaExpedicionFactura: "14-10-2026" },
    ]);
    const full = await addSeries("full");
    const issued = await withTransaction(v.db, async (tx) =>
      recordSubstitution(tx, v.backend, {
        ...input(await issuingClock(tx)),
        seriesId: full,
        counterparty: recipient,
        substitutedSaleIds: [first.saleId, second.saleId],
        total: "24.20",
        lines: [{ ...input(source()).lines[0]!, quantity: "2", lineTotal: "20.00" }],
      }),
    );
    expect(records(issued.saleId)[0]).toMatchObject({
      TipoFactura: "F3",
      IDFactura: { FechaExpedicionFactura: "15-10-2026" },
      FacturasSustituidas: { IDFacturaSustituida: originals.map((r) => r.IDFactura) },
      FechaHoraHusoGenRegistro: "2026-10-15T01:30:00+02:00",
      Encadenamiento: {
        RegistroAnterior: { Huella: originals[1]!.Huella, FechaExpedicionFactura: "14-10-2026" },
      },
    });
    expect([records(first.saleId)[0], records(second.saleId)[0]]).toEqual(originals);
  });
  it("voids once with the original identity day and zero allocated numbers", async () => {
    const old = await original();
    const before = records(old.saleId)[0];
    const numbers = await v.db.select().from(invoiceSeries);
    const issued = await withTransaction(v.db, async (tx) => {
      const clock = await voidClock(tx, old.saleId);
      const backend = regime.FISCAL_SLOT.makeBackend({
        db: v.db,
        clock,
        environment: "preproduction",
      });
      return recordVoid(tx, backend, old.saleId, "Operator error", { sessionId });
    });
    expect(issued.fiscal).toMatchObject({ issuedAt: new Date(AT), offsetMinutes: 120 });
    expect(records(old.saleId)).toHaveLength(2);
    expect(records(old.saleId)[0]).toEqual(before);
    expect(records(old.saleId)[1]).toMatchObject({
      IDFactura: { FechaExpedicionFacturaAnulada: "14-10-2026" },
      FechaHoraHusoGenRegistro: "2026-10-15T01:30:00+02:00",
    });
    expect(await v.db.select().from(invoiceSeries)).toEqual(numbers);
    const saved = snapshot();
    await expect(
      withTransaction(v.db, async (tx) =>
        recordVoid(
          tx,
          regime.FISCAL_SLOT.makeBackend({
            db: v.db,
            clock: await voidClock(tx, old.saleId),
            environment: "preproduction",
          }),
          old.saleId,
          "Again",
          { sessionId },
        ),
      ),
    ).rejects.toMatchObject({ code: "sale.already_voided" });
    expect(snapshot()).toEqual(saved);
  });
  it.each(["", "Invalid/Zone"])(
    "a direct core caller refuses saved zone %j before allocating or writing",
    async (timeZone) => {
      await v.db.update(locations).set({ timeZone }).where(eq(locations.id, v.cfg.locationId));
      const before = snapshot();
      await expect(
        withTransaction(v.db, async (tx) =>
          recordSale(tx, v.backend, input(await issuingClock(tx))),
        ),
      ).rejects.toMatchObject({
        code: "venue.time_zone_invalid",
        params: { reason: timeZone === "" ? "missing" : "invalid" },
      });
      expect(snapshot()).toEqual(before);
    },
  );
  it.each(["R5", "F3", "void"])(
    "a direct %s caller refuses a broken zone before any write",
    async (capability) => {
      const old = await original();
      const selected =
        capability === "R5"
          ? await addSeries("rectificative")
          : capability === "F3"
            ? await addSeries("full")
            : v.seriesId;
      await v.db
        .update(locations)
        .set({ timeZone: "Invalid/Zone" })
        .where(eq(locations.id, v.cfg.locationId));
      const before = snapshot();
      await expect(
        withTransaction(v.db, async (tx) => {
          if (capability === "void") {
            const clock = await voidClock(tx, old.saleId);
            return recordVoid(
              tx,
              regime.FISCAL_SLOT.makeBackend({ db: v.db, clock, environment: "preproduction" }),
              old.saleId,
              "Operator error",
              { sessionId },
            );
          }
          const clock = await issuingClock(tx);
          if (capability === "R5")
            return recordCorrection(tx, v.backend, {
              origin: v.cfg.origin,
              nodeId: v.cfg.nodeId,
              seriesId: selected,
              correctsSaleId: old.saleId,
              total: "-12.10",
              lines: [{ ...input(source()).lines[0]!, quantity: "-1", lineTotal: "-10.00" }],
              clock,
              authz: { sessionId },
            });
          return recordSubstitution(tx, v.backend, {
            ...input(clock),
            seriesId: selected,
            counterparty: recipient,
            substitutedSaleIds: [old.saleId],
          });
        }),
      ).rejects.toMatchObject({ code: "venue.time_zone_invalid", params: { reason: "invalid" } });
      expect(snapshot()).toEqual(before);
    },
  );
});
