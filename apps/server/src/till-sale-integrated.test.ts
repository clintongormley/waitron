import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createCategory, createProduct } from "@waitron/menu";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { fromRegistroRow, verifactuRecords, type RegistroRow } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { deploymentEnvironment } from "./config.js";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { billShare, takeBillPayment } from "./testing/bill-payment-fixture.js";
import { openTillSession } from "./testing/session-device.js";
import { takeReaderPaymentWithRecovery } from "./testing/bill-payment-fixture.js";
import { markOrderPlaced } from "./working-order-counter.js";
import { priceForIssuance, issueUnpaidInvoice } from "./working-order-invoice.js";
import { parkOrder } from "./working-order-open.js";
import { decimal } from "@waitron/shared";

describe("saved-zone payment transactions", () => {
  let zoneVenue: BillVenue;
  let zoneOffer: string;
  const zoneDb = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
  beforeEach(async () => {
    const db = zoneDb.db;
    zoneVenue = await provisionBillVenue(db);
    await withTransaction(db, async (tx) => {
      const category = await createCategory(tx, { name: "Clock test dishes" });
      const products = [];
      for (const [name, price] of [
        ["Night dish", "2.50"],
        ["Free dish", "0.00"],
      ]) {
        products.push(
          await createProduct(tx, {
            categoryId: category.id,
            name: name!,
            customerName: { "en-GB": `Customer ${name}` },
            kitchenName: `Kitchen ${name}`,
            pricingUnit: "each",
            unitPrice: decimal(price!),
            vatClass: "reduced",
          }),
        );
      }
      const offers = await offerProducts(tx, {
        productIds: products.map((p) => p.id),
      });
      zoneOffer = offers.offerFor(products[0]!.id);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  function zoneClock(at = "2026-10-14T23:30:00.000Z") {
    let instant = new Date(at);
    const reading = zoneVenue.clock.now();
    const now = vi.fn(() => ({ ...reading, instant: new Date(instant), offsetMinutes: 0 }));
    const clock: TrustedClock = { ...zoneVenue.clock, now };
    return {
      clock,
      now,
      set: (at: string) => {
        instant = new Date(at);
      },
    };
  }
  function zoneDeps(clock: TrustedClock, admission = testTradingAdmission()) {
    return {
      db: zoneDb.db,
      backend: zoneVenue.backend,
      clock,
      admission,
      provider: new FakePaymentProvider(zoneDb.db),
    };
  }
  function zoneRequest(offer = zoneOffer) {
    return {
      id: randomUUID() as string,
      lines: [{ menuItemId: offer, quantity: "1" }],
      expectedEdit: null,
    };
  }
  function economicSnapshot() {
    return Object.fromEntries(
      [
        "working_orders",
        "working_order_lines",
        "sales",
        "tenders",
        "payments",
        "verifactu_records",
        "invoice_series",
        "sale_settlements",
      ].map((table) => [
        table,
        zoneDb.db.all(sql`select * from ${sql.identifier(table)} order by rowid`),
      ]),
    );
  }
  async function issueFacts(id: string) {
    const rows = await zoneDb.db
      .select({
        issued_at: sales.issuedAt,
        issued_offset_minutes: sales.issuedOffsetMinutes,
        record: verifactuRecords,
      })
      .from(sales)
      .innerJoin(verifactuRecords, eq(verifactuRecords.saleId, sales.id))
      .where(eq(sales.workingOrderId, id));
    return rows.map((row) => ({
      issued_at: row.issued_at,
      issued_offset_minutes: row.issued_offset_minutes,
      fecha_expedicion_factura: row.record.fechaExpedicionFactura,
      fecha_hora_huso_gen_registro: fromRegistroRow(
        Object.fromEntries(
          Object.entries(getTableColumns(verifactuRecords)).map(([key, column]) => [
            column.name,
            row.record[key as keyof typeof row.record],
          ]),
        ) as RegistroRow,
      ).FechaHoraHusoGenRegistro,
    }));
  }
  const nightFacts = {
    issued_at: "2026-10-14T23:30:00.000Z",
    issued_offset_minutes: 120,
    fecha_expedicion_factura: "2026-10-15",
    fecha_hora_huso_gen_registro: "2026-10-15T01:30:00+02:00",
  };
  async function zoneHeld(req: ReturnType<typeof zoneRequest>) {
    await parkOrder({ db: zoneDb.db }, zoneVenue.cfg, {
      id: req.id,
      lines: req.lines,
      operatorId: zoneVenue.operatorId,
    });
  }
  async function zonePlaced(
    req: ReturnType<typeof zoneRequest>,
    clock: TrustedClock,
    issue: boolean,
    backend: FiscalBackend = zoneVenue.backend,
  ) {
    await zoneHeld(req);
    await withTransaction(zoneDb.db, async (tx) => {
      if (issue)
        await issueUnpaidInvoice(
          tx,
          backend,
          zoneVenue.cfg,
          await priceForIssuance(tx, clock, backend, zoneVenue.cfg, req.id),
          zoneVenue.operatorId,
          testTradingAdmission(),
        );
      await markOrderPlaced(tx, clock, zoneVenue.cfg, req.id, zoneVenue.operatorId);
    });
  }
  async function zoneOperator() {
    const personId = zoneVenue.operatorId;
    const sessionId = await openTillSession(zoneDb.db, {
      personId,
      deviceId: zoneVenue.cfg.origin.deviceId,
    });
    return { personId, sessionId };
  }
  it("pays and replays a presented no-fiscal bill", async () => {
    const { clock } = zoneClock();
    const config = venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat");
    const backend = fiscalSlot(enabledModules(ALL_MODULES, config), null).makeBackend({
      db: zoneDb.db,
      clock,
      environment: deploymentEnvironment(process.env),
    });
    const deps = { ...zoneDeps(clock), backend };
    const req = zoneRequest();
    await zonePlaced(req, clock, true, backend);

    const operator = await zoneOperator();
    const payment = billShare("cash", "2.50", { tendered: "3.00" });
    const paid = (await takeBillPayment(deps, zoneVenue.cfg, req.id, payment, operator)).invoice!;
    const replay = (await takeBillPayment(deps, zoneVenue.cfg, req.id, payment, operator)).invoice;

    expect(paid.total).toBe("2.50");
    expect(paid.tender).toEqual({ method: "cash", change: "0.50" });
    expect(paid.vatBreakdown).toEqual([{ rate: "10.00", base: "2.27", tax: "0.23" }]);
    expect(paid.qr).toBe("");
    expect(paid).not.toHaveProperty("invoiceType");
    expect(replay).toEqual(paid);
  });
  async function readerPay(
    deps: ReturnType<typeof zoneDeps>,
    req: ReturnType<typeof zoneRequest>,
    issued: boolean,
  ) {
    return takeReaderPaymentWithRecovery(
      deps,
      zoneVenue.cfg,
      req.id,
      billShare("card", "2.50", { entry: "reader", submissionId: req.id }),
      await zoneOperator(),
      issued ? undefined : { lines: req.lines },
    );
  }

  it.each([false, true])(
    "closed admission retains a completed capture for later finalization (issued=%s)",
    async (issued) => {
      const source = zoneClock();
      const deps = zoneDeps(source.clock);
      const req = zoneRequest();
      if (issued) await zonePlaced(req, source.clock, true);
      const collect = deps.provider.collect.bind(deps.provider);
      let captured!: () => void;
      const seen = new Promise<void>((r) => {
        captured = r;
      });
      let release!: () => void;
      const reply = new Promise<void>((r) => {
        release = r;
      });
      vi.spyOn(deps.provider, "collect").mockImplementation(async (params) => {
        const answer = await collect(params);
        captured();
        await reply;
        return answer;
      });
      const paying = readerPay(deps, req, issued);
      const rejected = expect(paying).rejects.toMatchObject({
        code: "venue.time_zone_not_ready",
        params: { reason: "restart_required" },
      });
      try {
        await seen;
        const before = economicSnapshot();
        deps.admission.requireRestart();
        release();
        await rejected;
        expect(economicSnapshot()).toEqual(before);
        expect(deps.provider.collectCalls).toHaveLength(1);
        await expect(readerPay(deps, req, issued)).rejects.toMatchObject({
          code: "venue.time_zone_not_ready",
        });
        expect(economicSnapshot()).toEqual(before);
        expect(deps.provider.collectCalls).toHaveLength(1);
        deps.admission.admit();
        const out = await readerPay(deps, req, issued);
        expect(out.outcome).toBe("received");
        expect(deps.provider.collectCalls).toHaveLength(1);
        expect(await issueFacts(req.id)).toHaveLength(1);
        const saved = economicSnapshot();
        deps.admission.requireRestart();
        const unreadable: TrustedClock = {
          ...source.clock,
          now: () => {
            throw new Error("saved replay read the issue clock");
          },
        };
        await expect(readerPay({ ...deps, clock: unreadable }, req, issued)).resolves.toMatchObject(
          { outcome: "received" },
        );
        expect(economicSnapshot()).toEqual(saved);
      } finally {
        release();
        await paying.catch(() => {});
      }
    },
  );
  it.each([false, true])(
    "recovery checks admission inside its final transaction (issued=%s)",
    async (issued) => {
      const source = zoneClock();
      const deps = zoneDeps(source.clock);
      const req = zoneRequest();
      if (issued) await zonePlaced(req, source.clock, true);
      deps.provider.crashNextCollect("captured");
      await expect(readerPay(deps, req, issued)).rejects.toThrow("process stopped");
      const before = economicSnapshot();
      const original = zoneDb.db.withWriteLock.bind(zoneDb.db);
      const boundary = vi.spyOn(zoneDb.db, "withWriteLock").mockImplementationOnce((body) =>
        original(async () => {
          deps.admission.requireRestart();
          return body();
        }),
      );
      try {
        await expect(readerPay(deps, req, issued)).rejects.toMatchObject({
          code: "venue.time_zone_not_ready",
        });
        expect(economicSnapshot()).toEqual(before);
        expect(deps.provider.collectCalls).toHaveLength(1);
      } finally {
        boundary.mockRestore();
      }
      deps.admission.admit();
      await readerPay(deps, req, issued);
      expect(deps.provider.collectCalls).toHaveLength(1);
      expect(await issueFacts(req.id)).toEqual([nightFacts]);
    },
  );
  it.each(["cash", "card"] as const)(
    "collects a placed but unissued order with %s at the saved issue offset",
    async (method) => {
      const source = zoneClock();
      const req = zoneRequest();
      await zonePlaced(req, source.clock, false);
      await takeBillPayment(
        zoneDeps(source.clock),
        zoneVenue.cfg,
        req.id,
        billShare(method, "2.50"),
        await zoneOperator(),
      );
      expect(await issueFacts(req.id)).toEqual([nightFacts]);
    },
  );
});
