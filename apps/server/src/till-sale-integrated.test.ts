import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { locations, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createCategory, createProduct } from "@waitron/catalogue";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { fromRegistroRow, registrosFacturacion, type RegistroRow } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { TradingAdmission } from "./trading-admission.js";
import {
  payWorkingOrderIntegratedOrchestration as readerPay,
  payWorkingOrder,
  collectOrderOrchestration as collectOrder,
} from "./testing/whole-payment-fixture.js";
import {
  parkOrder,
  priceForIssuance,
  issueUnpaidInvoice,
  markOrderPlaced,
} from "./working-order.js";
import { readVenueDetails, writeVenueDetails } from "./venue-details.js";
import { decimal } from "@waitron/shared";
import type { PaymentResult } from "@waitron/payments";
import { toPayOutcome } from "./till-sale.js";
import type { TillSaleResult } from "./till-sale.js";

// The orchestrator calls `toPayOutcome` only for non-captured states, so this is the one place its
// `captured`/`accepted_offline` arms run.

const TICKET: TillSaleResult = {
  receiptTrim: {},
  venueAddress: [],
  receiptSettings: { printAddress: false },
  locale: "es-ES",
  orderLabel: null,
  orderNumber: 1,
  invoiceNumber: "A/1",
  issuedAt: "2026-08-06T10:00:00.000Z",
  total: "1.50",
  vatBreakdown: [{ rate: "21.00", base: "1.24", tax: "0.26" }],
  lines: [{ descriptions: { "es-ES": "Café" }, quantity: "1", gross: "1.50" }],
  tender: { method: "cash", change: "0.00" },
  qr: "https://example.test/verify",
};

function result(state: PaymentResult["state"]): PaymentResult {
  return {
    provider: "stripe",
    paymentRef: "ref-1",
    state,
    amount: decimal("1.50"),
    settledAt: state === "captured" || state === "accepted_offline" ? new Date() : null,
  };
}

describe("toPayOutcome", () => {
  it("captured → { outcome: 'captured', ticket }", () => {
    expect(toPayOutcome(result("captured"), TICKET)).toEqual({
      outcome: "captured",
      ticket: TICKET,
    });
  });

  it("accepted_offline → { outcome: 'captured', ticket } (the offline card chained a sale immediately)", () => {
    expect(toPayOutcome(result("accepted_offline"), TICKET)).toEqual({
      outcome: "captured",
      ticket: TICKET,
    });
  });

  it("network_unavailable → { outcome: 'network_unavailable' } (nothing filed, retryable)", () => {
    expect(toPayOutcome(result("network_unavailable"), null)).toEqual({
      outcome: "network_unavailable",
    });
  });

  it("failed → { outcome: 'declined' }", () => {
    expect(toPayOutcome(result("failed"), null)).toEqual({ outcome: "declined" });
  });

  it("maps an attempting result to the timeout arm", () => {
    expect(toPayOutcome(result("attempting"), null)).toEqual({ outcome: "timeout" });
  });
});

describe("staff-only card failure metadata", () => {
  it("carries the provider reason on a decline", () => {
    expect(
      toPayOutcome({ ...result("failed"), failureReason: "insufficient_funds" }, null),
    ).toEqual({ outcome: "declined", failureReason: "insufficient_funds" });
  });
  it.each([
    "attempting",
    "network_unavailable",
    "captured",
    "accepted_offline",
    "initiated",
    "voided",
    "refunded",
    "partially_refunded",
    "settled",
    "declined",
  ] as const)("never attaches a stale decline reason to %s", (state) => {
    const out = toPayOutcome(
      { ...result(state), failureReason: "lost_card" },
      state === "captured" || state === "accepted_offline" ? TICKET : null,
    );
    expect(out).not.toHaveProperty("failureReason");
  });
});

describe("saved-zone payment transactions", () => {
  let zoneVenue: BillVenue;
  let zoneOffer: string;
  let freeOffer: string;
  const zoneDb = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
  beforeEach(async () => {
    const db = zoneDb.db;
    zoneVenue = await provisionBillVenue(db);
    await withTransaction(db, async (tx) => {
      const category = await createCategory(tx, { name: "Clock test dishes" });
      const catalogueId = tx.all<{ id: string }>(sql`select id from catalogues limit 1`)[0]!.id;
      const products = [];
      for (const [name, price] of [
        ["Night dish", "2.50"],
        ["Free dish", "0.00"],
      ]) {
        products.push(
          await createProduct(tx, {
            catalogueId,
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
      const offers = await offerProducts(tx, zoneVenue.cfg, {
        productIds: products.map((p) => p.id),
      });
      zoneOffer = offers.offerFor(products[0]!.id);
      freeOffer = offers.offerFor(products[1]!.id);
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
        "registros_facturacion",
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
        record: registrosFacturacion,
      })
      .from(sales)
      .innerJoin(registrosFacturacion, eq(registrosFacturacion.saleId, sales.id))
      .where(eq(sales.workingOrderId, id));
    return rows.map((row) => ({
      issued_at: row.issued_at,
      issued_offset_minutes: row.issued_offset_minutes,
      fecha_expedicion_factura: row.record.fechaExpedicionFactura,
      fecha_hora_huso_gen_registro: fromRegistroRow(
        Object.fromEntries(
          Object.entries(getTableColumns(registrosFacturacion)).map(([key, column]) => [
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
  ) {
    await zoneHeld(req);
    await withTransaction(zoneDb.db, async (tx) => {
      if (issue)
        await issueUnpaidInvoice(
          tx,
          zoneVenue.backend,
          zoneVenue.cfg,
          await priceForIssuance(tx, clock, zoneVenue.cfg, req.id),
          zoneVenue.operatorId,
          testTradingAdmission(),
        );
      await markOrderPlaced(tx, clock, zoneVenue.cfg, req.id, zoneVenue.operatorId);
    });
  }
  describe("whole-order saved-zone issuance", () => {
    it.each(["walk-up", "held", "placed", "free"] as const)(
      "dates %s in Madrid while the source clock reports UTC",
      async (kind) => {
        const { clock } = zoneClock();
        const deps = zoneDeps(clock);
        const req = zoneRequest(kind === "free" ? freeOffer : zoneOffer);
        if (kind === "held") await zoneHeld(req);
        if (kind === "placed") await zonePlaced(req, clock, false);
        const out = await readerPay(deps, zoneVenue.cfg, req);
        expect(out.outcome).toBe("captured");
        expect(await issueFacts(req.id)).toEqual([nightFacts]);
        expect(deps.provider.collectCalls).toHaveLength(kind === "free" ? 0 : 1);
      },
    );
    it.each(["cash", "card"] as const)("dates immediate %s from the saved zone", async (method) => {
      const { clock, now } = zoneClock();
      const deps = zoneDeps(clock);
      const req = zoneRequest();
      await payWorkingOrder(deps, zoneVenue.cfg, { ...req, tender: { method, amount: "2.50" } });
      expect(await issueFacts(req.id)).toEqual([nightFacts]);
      expect(now).toHaveBeenCalledTimes(1);
    });
    it.each(["cash", "card", "reader"] as const)(
      "collects an already-issued invoice with %s without redating or issuing again",
      async (method) => {
        const source = zoneClock();
        const deps = zoneDeps(source.clock);
        const req = zoneRequest();
        await zonePlaced(req, source.clock, true);
        const before = await issueFacts(req.id);
        source.set("2026-10-25T02:30:00.000Z");
        if (method === "reader") await readerPay(deps, zoneVenue.cfg, req);
        else
          await collectOrder(deps, zoneVenue.cfg, { ...req, tender: { method, amount: "2.50" } });
        expect(before).toEqual([nightFacts]);
        expect(await issueFacts(req.id)).toEqual(before);
      },
    );
    for (const state of ["unchecked", "missing", "invalid", "restart_required"] as const) {
      it.each(["cash", "card", "reader", "collection"] as const)(
        `${state} refuses %s before any economic write`,
        async (method) => {
          const source = zoneClock();
          const admission = new TradingAdmission();
          if (state === "restart_required") admission.requireRestart();
          else if (state !== "unchecked") admission.repairOnly(state);
          const deps = zoneDeps(source.clock, admission);
          const req = zoneRequest();
          if (method === "collection") await zonePlaced(req, source.clock, true);
          const before = economicSnapshot();
          const run =
            method === "reader"
              ? readerPay(deps, zoneVenue.cfg, req)
              : method === "collection"
                ? collectOrder(deps, zoneVenue.cfg, {
                    ...req,
                    tender: { method: "cash", amount: "2.50" },
                  })
                : payWorkingOrder(deps, zoneVenue.cfg, {
                    ...req,
                    tender: { method, amount: "2.50" },
                  });
          await expect(run).rejects.toMatchObject({
            code: "venue.time_zone_not_ready",
            params: { reason: state },
          });
          expect(deps.provider.collectCalls).toHaveLength(0);
          expect(economicSnapshot()).toEqual(before);
        },
      );
    }
    it.each(["name", "instant", "formatter"] as const)(
      "refuses a bad %s before asking a reader or storing the order",
      async (fault) => {
        const source = zoneClock();
        const deps = zoneDeps(source.clock);
        const req = zoneRequest();
        const original = zoneDb.db.all<{ time_zone: string }>(
          sql`select time_zone from locations where id = ${zoneVenue.cfg.locationId}`,
        )[0]!.time_zone;
        if (fault === "name")
          await zoneDb.db
            .update(locations)
            .set({ timeZone: "Invalid/Zone" })
            .where(eq(locations.id, zoneVenue.cfg.locationId));
        if (fault === "instant") source.set("invalid");
        if (fault === "formatter")
          vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(() => {
            throw new Error("formatter stopped");
          });
        const before = economicSnapshot();
        try {
          const paying = readerPay(deps, zoneVenue.cfg, req);
          if (fault === "formatter") await expect(paying).rejects.toThrow("formatter stopped");
          else
            await expect(paying).rejects.toMatchObject({
              code:
                fault === "name" ? "venue.time_zone_invalid" : "venue.time_zone_conversion_failed",
            });
          expect(deps.provider.collectCalls).toHaveLength(0);
          expect(economicSnapshot()).toEqual(before);
          expect(deps.admission.snapshot()).toEqual({ state: "ready" });
        } finally {
          vi.restoreAllMocks();
          await zoneDb.db
            .update(locations)
            .set({ timeZone: original })
            .where(eq(locations.id, zoneVenue.cfg.locationId));
        }
      },
    );
    it.each([
      [
        "midnight",
        "2026-10-14T21:59:59.000Z",
        "2026-10-14T22:00:01.000Z",
        120,
        "2026-10-15",
        "2026-10-15T00:00:01+02:00",
      ],
      [
        "spring",
        "2026-03-29T00:59:59.000Z",
        "2026-03-29T01:00:01.000Z",
        120,
        "2026-03-29",
        "2026-03-29T03:00:01+02:00",
      ],
      [
        "autumn",
        "2026-10-25T00:59:59.000Z",
        "2026-10-25T01:00:01.000Z",
        60,
        "2026-10-25",
        "2026-10-25T02:00:01+01:00",
      ],
    ] as const)(
      "reads a fresh issue offset after a capture held across %s",
      async (_label, start, end, offset, day, literal) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(start));
        const source = zoneClock(start);
        const deps = zoneDeps(source.clock);
        const req = zoneRequest();
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
        const paying = readerPay(deps, zoneVenue.cfg, req);
        try {
          await seen;
          const capture = zoneDb.db.all<Record<string, unknown>>(
            sql`select * from payments where working_order_id = ${req.id}`,
          );
          const model = await withTransaction(zoneDb.db, (tx) =>
            readVenueDetails(tx, zoneVenue.cfg),
          );
          await expect(
            withTransaction(zoneDb.db, (tx) =>
              writeVenueDetails(tx, zoneVenue.cfg, {
                expected: model.details,
                changes: { timeZone: "Atlantic/Canary" },
              }),
            ),
          ).rejects.toMatchObject({
            code: "venue.detail_locked",
            params: { field: "timeZone", reason: "orders" },
          });
          source.set(end);
          release();
          const out = await paying;
          expect(out.outcome).toBe("captured");
          expect(await issueFacts(req.id)).toEqual([
            {
              issued_at: end,
              issued_offset_minutes: offset,
              fecha_expedicion_factura: day,
              fecha_hora_huso_gen_registro: literal,
            },
          ]);
          expect(source.now).toHaveBeenCalledTimes(2);
          expect(deps.provider.collectCalls).toHaveLength(1);
          const after = zoneDb.db.all<Record<string, unknown>>(
            sql`select * from payments where working_order_id = ${req.id}`,
          );
          expect(after).toEqual(
            capture.map((row) => ({
              ...row,
              sale_id: (after[0] as Record<string, unknown>).sale_id,
            })),
          );
          expect(
            zoneDb.db.all(
              sql`select amount, settled_at from payments where working_order_id = ${req.id}`,
            ),
          ).toEqual([{ amount: 250, settled_at: start }]);
        } finally {
          release();
          await paying.catch(() => {});
        }
      },
    );
    it("recovers a persisted capture without collecting again or changing capture facts", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-14T21:59:00.000Z"));
      const source = zoneClock();
      const deps = zoneDeps(source.clock);
      const req = zoneRequest();
      deps.provider.crashNextCollect("captured");
      await expect(readerPay(deps, zoneVenue.cfg, req)).rejects.toThrow("process stopped");
      const before = zoneDb.db.all<Record<string, unknown>>(
        sql`select * from payments where working_order_id = ${req.id}`,
      );
      expect(await issueFacts(req.id)).toEqual([]);
      const out = await readerPay(deps, zoneVenue.cfg, req);
      expect(out.outcome).toBe("captured");
      expect(await issueFacts(req.id)).toEqual([nightFacts]);
      expect(deps.provider.collectCalls).toHaveLength(1);
      const after = zoneDb.db.all<Record<string, unknown>>(
        sql`select * from payments where working_order_id = ${req.id}`,
      );
      expect(after).toEqual(
        before.map((row) => ({ ...row, sale_id: (after[0] as Record<string, unknown>).sale_id })),
      );
    });
  });

  it("accepted-offline capture keeps its received facts and uses the fresh issue reading", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T21:59:00.000Z"));
    const source = zoneClock();
    const deps = zoneDeps(source.clock);
    const req = zoneRequest();
    zoneDb.db.run(
      sql`insert into payment_policy (id, offline_mode, offline_amount_cap, created_at, updated_at) values (1, 'accept_offline', 1000, '2026-10-14T21:59:00.000Z', '2026-10-14T21:59:00.000Z')`,
    );
    deps.provider.offlineNextCollect();
    const out = await readerPay(deps, zoneVenue.cfg, { ...req, allowOffline: true });
    expect(out.outcome).toBe("captured");
    expect(await issueFacts(req.id)).toEqual([nightFacts]);
    expect(
      zoneDb.db.all(
        sql`select state, amount, settled_at from payments where working_order_id = ${req.id}`,
      ),
    ).toEqual([{ state: "accepted_offline", amount: 250, settled_at: "2026-10-14T21:59:00.000Z" }]);
  });
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
      const paying = readerPay(deps, zoneVenue.cfg, req);
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
        await expect(readerPay(deps, zoneVenue.cfg, req)).rejects.toMatchObject({
          code: "venue.time_zone_not_ready",
        });
        expect(economicSnapshot()).toEqual(before);
        expect(deps.provider.collectCalls).toHaveLength(1);
        deps.admission.admit();
        const out = await readerPay(deps, zoneVenue.cfg, req);
        expect(out.outcome).toBe("captured");
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
        await expect(
          readerPay({ ...deps, clock: unreadable }, zoneVenue.cfg, req),
        ).resolves.toMatchObject({ outcome: "captured" });
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
      await expect(readerPay(deps, zoneVenue.cfg, req)).rejects.toThrow("process stopped");
      const before = economicSnapshot();
      const original = zoneDb.db.withWriteLock.bind(zoneDb.db);
      let transactions = 0;
      const boundary = vi.spyOn(zoneDb.db, "withWriteLock").mockImplementation((body) => {
        transactions += 1;
        if (transactions === 2)
          return original(async () => {
            deps.admission.requireRestart();
            return body();
          });
        return original(body);
      });
      try {
        await expect(readerPay(deps, zoneVenue.cfg, req)).rejects.toMatchObject({
          code: "venue.time_zone_not_ready",
        });
        expect(economicSnapshot()).toEqual(before);
        expect(deps.provider.collectCalls).toHaveLength(1);
      } finally {
        boundary.mockRestore();
      }
      deps.admission.admit();
      await readerPay(deps, zoneVenue.cfg, req);
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
      await collectOrder(zoneDeps(source.clock), zoneVenue.cfg, {
        ...req,
        tender: { method, amount: "2.50" },
      });
      expect(await issueFacts(req.id)).toEqual([nightFacts]);
    },
  );
});
