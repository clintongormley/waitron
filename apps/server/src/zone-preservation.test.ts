import { decimal } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { invoiceSeries, locations, printers, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordSale } from "@waitron/core";
import { prepareIssueClock } from "@waitron/fiscal";
import {
  assertValid,
  computeHuella,
  type EnvioRegistro,
  type VerifactuClient,
} from "@waitron/verifactu";
import { createFakeAeat, keyOf } from "@waitron/verifactu/testing";
import { decodeRegistroRow, fromRegistroRow } from "@waitron/fiscal-verifactu/src/registro-row.js";
import { drain, resetInFlightClaims } from "@waitron/fiscal-verifactu/src/drain.js";
import { reconcile } from "@waitron/fiscal-verifactu/src/reconcile.js";
import { listFilingCases, recordCaseEvent } from "@waitron/fiscal-verifactu/src/filing-cases.js";
import { exportConfigurationTables } from "@waitron/provisioning";
import { recordDailyClose } from "@waitron/reporting";
import { ALL_MODULES } from "./modules.js";
import { zonePaymentVenue } from "./testing/zone-payment-venue.js";
import { takeBillPayment, takeReaderBillPayment } from "./bill-payments.js";
import { TradingAdmission } from "./trading-admission.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { enqueueReceiptCopy } from "./receipt-print.js";

let v: Awaited<ReturnType<typeof zonePaymentVenue>>;
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
beforeEach(async () => {
  v = await zonePaymentVenue(suite.db);
});
const AT = "2026-10-31T23:30:00.000Z";
const SEND = new Date("2026-11-02T12:00:00.000Z");
function facts() {
  return Object.fromEntries(
    [
      "sales",
      "sale_lines",
      "sale_settlements",
      "tenders",
      "payments",
      "payment_refunds",
      "bill_payments",
      "bill_payment_refunds",
      "invoice_series",
      "registros_facturacion",
      "cadenas",
      "daily_closes",
      "daily_close_chain",
    ].map((name) => [name, v.db.all(sql`select * from ${sql.identifier(name)} order by rowid`)]),
  );
}
function records() {
  return v.db
    .all<Record<string, unknown>>(sql`select * from registros_facturacion order by secuencia`)
    .map((raw) => {
      const record = fromRegistroRow(decodeRegistroRow(raw));
      assertValid(record, { now: SEND });
      expect(computeHuella(record)).toBe(raw.huella);
      return record;
    });
}
async function issue() {
  const source = {
    ...v.clock,
    now: () => ({ ...v.clock.now(), instant: new Date(AT), offsetMinutes: 0 }),
  };
  return withTransaction(v.db, async (tx) =>
    recordSale(tx, v.backend, {
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
      vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
      settlement: { kind: "deferred" },
      clock: await prepareIssueClock(tx, v.cfg, source),
    }),
  );
}
async function closeHistory() {
  await withTransaction(v.db, (tx) =>
    recordDailyClose(tx, {
      nodeId: v.cfg.nodeId,
      businessDay: "2026-10-31",
      timeZone: "Europe/Madrid",
      closedBy: v.operator.personId,
      cashCounts: [],
    }),
  );
}
async function due(at = SEND) {
  await v.db.execute(
    sql`update envios set proximo_intento_en = ${at.toISOString()} where estado = 'pendiente'`,
  );
}
function wire(client: VerifactuClient) {
  const sent: EnvioRegistro[][] = [];
  const filters: unknown[] = [];
  const recording: VerifactuClient = {
    submit: async (header, batch) => {
      sent.push(structuredClone(batch));
      return client.submit(header, batch);
    },
    consultar: async (...args) => {
      filters.push(structuredClone(args));
      return client.consultar(...args);
    },
  };
  return { sent, filters, client: recording };
}
function send(client: VerifactuClient, at = SEND) {
  return drain(
    {
      db: v.db,
      resolveClient: async () => client,
      environment: "preproduction",
      skipRetryMs: 300_000,
    },
    at,
  );
}
function sentRecords(batches: EnvioRegistro[][]) {
  return batches.flat().map((entry) => {
    const record = "RegistroAlta" in entry ? entry.RegistroAlta : entry.RegistroAnulacion;
    const { RefExterna: reference, ...saved } = record;
    expect(reference).toEqual(expect.any(String));
    return saved;
  });
}
async function breakCurrentZone() {
  await v.db
    .update(locations)
    .set({ timeZone: "Invalid/Zone" })
    .where(eq(locations.id, v.cfg.locationId));
}

it.each(["cash", "reader"] as const)(
  "authenticated bill replay, historical receipt and reprint acquire no issue reading or economic writes (%s)",
  async (kind) => {
    const id = await v.bill();
    const request = await v.request(id, kind === "cash" ? "cash" : "card");
    const take = kind === "cash" ? takeBillPayment : takeReaderBillPayment;
    const original = await take(v.deps, v.cfg, id, request, v.operator);
    const collections = v.card.collectCalls.length;
    await withTransaction(v.db, (tx) =>
      recordDailyClose(tx, {
        nodeId: v.cfg.nodeId,
        businessDay: "2026-10-14",
        timeZone: "Europe/Madrid",
        closedBy: v.operator.personId,
        cashCounts:
          kind === "reader"
            ? []
            : [
                {
                  deviceId: v.cfg.origin.deviceId,
                  openingFloat: "0.00",
                  payouts: "0.00",
                  countedCash: "24.20",
                },
              ],
      }),
    );
    const before = facts();
    expect(before.daily_closes).toHaveLength(1);
    if (kind === "reader") expect(before.payments).toHaveLength(1);
    const saved = records();
    const saleId = String(
      v.db.all<{ id: string }>(sql`select id from sales where working_order_id = ${id}`)[0]!.id,
    );
    const ticket = await withTransaction(v.db, (tx) =>
      readTransactionReceipt(v.backend, tx, v.cfg, saleId),
    );
    expect(new URL(ticket.qr).searchParams.get("fecha")).toBe("15-10-2026");
    const admission = new TradingAdmission();
    admission.repairOnly("invalid");
    const now = vi.fn(() => {
      throw new Error("historical operation acquired an issue reading");
    });
    const deps = { ...v.deps, admission, clock: { ...v.clock, now } };
    await breakCurrentZone();
    await expect(take(deps, v.cfg, id, request, v.operator)).resolves.toEqual(original);
    await expect(
      take(deps, v.cfg, id, request, { ...v.operator, sessionId: randomUUID() }),
    ).rejects.toMatchObject({ code: "session.required" });
    await withTransaction(v.db, async (tx) => {
      const historical = await readTransactionReceipt(v.backend, tx, v.cfg, saleId);
      expect(historical).toEqual(ticket);
      const [printer] = await tx.select().from(printers);
      expect(
        await enqueueReceiptCopy(tx, v.cfg, historical, saleId, printer!, "en-GB"),
      ).toBeDefined();
    });
    expect(now).not.toHaveBeenCalled();
    expect(v.card.collectCalls).toHaveLength(collections);
    expect(records()).toEqual(saved);
    expect(facts()).toEqual(before);
  },
);

it.each(["failed-send", "lost-answer", "restart", "duplicate-lookup", "no-trace"] as const)(
  "%s reconstructs the original identity, month, offset and hash after a zone change",
  async (mode) => {
    await issue();
    const saved = records();
    expect(saved[0]).toMatchObject({
      IDFactura: { FechaExpedicionFactura: "01-11-2026" },
      FechaHoraHusoGenRegistro: "2026-11-01T00:30:00+01:00",
    });
    await closeHistory();
    const before = facts();
    expect(before.daily_closes).toHaveLength(1);
    const aeat = createFakeAeat({ serverNow: SEND });
    const tracked = wire(aeat.client());
    await breakCurrentZone();
    await due();
    if (mode === "failed-send" || mode === "lost-answer") {
      const broken: VerifactuClient = {
        ...tracked.client,
        submit: async (header, batch) => {
          if (mode === "lost-answer") await tracked.client.submit(header, batch);
          throw new Error("synthetic connection lost");
        },
      };
      expect((await send(broken)).recordsAccepted).toBe(0);
      expect(facts()).toEqual(before);
    } else if (mode === "restart") {
      await v.db.execute(
        sql`update envios set estado = 'enviando', enviado_en = ${SEND.toISOString()}`,
      );
      await resetInFlightClaims(v.db, SEND);
    } else {
      expect((await send(tracked.client)).recordsAccepted).toBe(1);
      if (mode === "no-trace") {
        aeat.forget(keyOf(saved[0]!));
        const result = await reconcile(
          {
            db: v.db,
            resolveClient: async () => tracked.client,
            clock: { ...v.clock, now: () => ({ ...v.clock.now(), instant: SEND }) },
          },
          { year: "2026", month: "11" },
        );
        expect(result.checked).toBe(1);
        expect(result.noTrace).toHaveLength(1);
      } else {
        aeat.dropRegistroDuplicadoDetail(keyOf(saved[0]!));
        await v.db.execute(sql`update envios set estado = 'pendiente'`);
      }
    }
    const later = new Date(SEND.getTime() + 3_600_000);
    await due(later);
    expect((await send(tracked.client, later)).recordsAccepted).toBe(1);
    expect(sentRecords(tracked.sent)).toEqual(tracked.sent.map(() => saved[0]));
    const reconciled = await reconcile(
      {
        db: v.db,
        resolveClient: async () => tracked.client,
        clock: { ...v.clock, now: () => ({ ...v.clock.now(), instant: later }) },
      },
      { year: "2026", month: "10" },
    );
    expect(reconciled.checked).toBe(0);
    if (mode === "duplicate-lookup")
      expect(tracked.filters).toEqual([
        [
          expect.anything(),
          {
            Ejercicio: "2026",
            Periodo: "11",
            FechaExpedicionFactura: "01-11-2026",
            NumSerieFactura: "A/1",
            DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" },
          },
        ],
      ]);
    expect(records()).toEqual(saved);
    expect(facts()).toEqual(before);
  },
);

it("brake probe, release and filing-case resolution retain the original fiscal and close rows", async () => {
  for (let index = 0; index < 3; index++) await issue();
  const aeat = createFakeAeat({ serverNow: SEND, tiempoEsperaInicial: 5 });
  for (const record of records()) aeat.reject(keyOf(record), 1100, "Synthetic refusal");
  await due();
  expect((await send(aeat.client())).recordsHalted).toBe(3);
  for (let index = 0; index < 2; index++) await issue();
  await closeHistory();
  const saved = records(),
    before = facts();
  await breakCurrentZone();
  const heldAt = new Date(SEND.getTime() + 60_000);
  await due(heldAt);
  expect((await send(aeat.client(), heldAt)).recordsHalted).toBe(2);
  const tracked = wire(aeat.client());
  const probeAt = new Date(heldAt.getTime() + 3_600_000);
  expect((await send(tracked.client, probeAt)).recordsAccepted).toBe(1);
  expect((await send(tracked.client, new Date(probeAt.getTime() + 60_000))).recordsAccepted).toBe(
    1,
  );
  expect(sentRecords(tracked.sent)).toEqual(saved.slice(3));
  const cases = await withTransaction(v.db, (tx) => listFilingCases(tx));
  expect(cases).toHaveLength(3);
  const input = {
    caseId: cases[0]!.id,
    actionKey: randomUUID(),
    kind: "resolved" as const,
    personId: v.operator.personId,
    action: "External resolution recorded",
    now: probeAt,
  };
  const event = await withTransaction(v.db, (tx) => recordCaseEvent(tx, input));
  expect(await withTransaction(v.db, (tx) => recordCaseEvent(tx, input))).toEqual(event);
  expect(
    (await withTransaction(v.db, (tx) => listFilingCases(tx))).find(
      (row) => row.id === input.caseId,
    ),
  ).toMatchObject({ status: "resolved", events: [event] });
  expect(records()).toEqual(saved);
  expect(facts()).toEqual(before);
});

it("configuration export carries settings without fiscal, payment, location history or chain rows", async () => {
  await issue();
  await closeHistory();
  const before = facts();
  const exported = await exportConfigurationTables(v.db, ALL_MODULES);
  expect(exported.tables.products?.length).toBeGreaterThan(0);
  for (const name of [
    ...Object.keys(before),
    "locations",
    "nodes",
    "location_business_day_settings",
    "location_business_day_changes",
    "fiscal_allocations",
    "registro_sif",
  ])
    expect(exported.tables).not.toHaveProperty(name);
  expect(facts()).toEqual(before);
  expect((await v.db.select().from(invoiceSeries)).some((row) => row.nextNumber > 1)).toBe(true);
});
