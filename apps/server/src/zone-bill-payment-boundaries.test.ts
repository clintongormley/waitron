import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { billPayments, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loadKeyRing } from "@waitron/credentials";
import { startManagementSession } from "@waitron/identity";
import { payments } from "@waitron/payments";
import { fromRegistroRow, type RegistroRow } from "@waitron/fiscal-verifactu";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { takeBillPayment, takeReaderBillPayment, completeBillPayment } from "./bill-payments.js";
import { settlePendingBillPayments, settleFromProviderRow } from "./bill-payments-loop.js";
import { refundBillPayment } from "./bill-refunds.js";
import { mountPaymentsApi } from "./payments-api.js";
import { TradingAdmission } from "./trading-admission.js";
import { zonePaymentVenue } from "./testing/zone-payment-venue.js";
import { send } from "./testing/bill-venue.js";

let v: Awaited<ReturnType<typeof zonePaymentVenue>>;
useVenueDb({
  resetPerTest: false,
  timeoutMs: 60_000,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    v = await zonePaymentVenue(db);
  },
});
const night = [{ instant: "2026-10-14T23:30:00.000Z", offset: 120 }];
beforeEach(() => v.set("2026-10-14T23:30:00.000Z"));
function close(state: string) {
  const admission = new TradingAdmission();
  if (state === "restart_required") admission.requireRestart();
  else if (state === "invalid" || state === "missing") admission.repairOnly(state);
  return admission;
}
async function guardedTransaction<T>(body: Parameters<typeof withTransaction<T>>[1]) {
  return withTransaction(v.db, body);
}
function recordFacts(id: string) {
  return v.db
    .all<RegistroRow>(
      sql`select r.* from registros_facturacion r join sales s on s.id = r.sale_id where s.working_order_id = ${id}`,
    )
    .map((row) => {
      const record = fromRegistroRow(row);
      return {
        day:
          "FechaExpedicionFactura" in record.IDFactura
            ? record.IDFactura.FechaExpedicionFactura
            : null,
        generation: record.FechaHoraHusoGenRegistro,
      };
    });
}

describe("bill payment admission and issue clocks", () => {
  it("serializes worker, manager and till completion to one saved invoice and its effects", async () => {
    const id = await v.bill();
    const request = await v.request(id, "card");
    v.card.crashNextCollect("captured");
    await expect(takeReaderBillPayment(v.deps, v.cfg, id, request, v.operator)).rejects.toThrow(
      "process stopped",
    );
    const [p] = await v.db.select().from(billPayments).where(eq(billPayments.workingOrderId, id));
    const calls = v.card.collectCalls.length;
    await Promise.all([
      settlePendingBillPayments(v.deps),
      withTransaction(v.db, (tx) =>
        settleFromProviderRow(tx, v.deps, p!.id, new Date("2026-10-14T23:30:00.000Z"), "stored"),
      ),
      takeReaderBillPayment(v.deps, v.cfg, id, request, v.operator),
    ]);
    expect(await v.facts(id)).toEqual(night);
    expect(recordFacts(id)).toEqual([
      { day: "15-10-2026", generation: "2026-10-15T01:30:00+02:00" },
    ]);
    const saved = v.snapshot();
    expect(
      await withTransaction(v.db, (tx) =>
        settleFromProviderRow(tx, v.deps, p!.id, new Date(), "stored"),
      ),
    ).toEqual({ settled: "left", providerState: "pending" });
    expect(v.snapshot()).toEqual(saved);
    expect(v.card.collectCalls).toHaveLength(calls);
  });
  it.each(["cash", "manual", "reader"])(
    "preserves partial %s received time and dates the final invoice in Madrid",
    async (kind) => {
      const id = await v.bill();
      v.set("2026-10-14T21:59:59.000Z");
      const method = kind === "cash" ? "cash" : "card";
      const take = kind === "reader" ? takeReaderBillPayment : takeBillPayment;
      const first = await take(v.deps, v.cfg, id, await v.request(id, method, "12.10"), v.operator);
      expect(first.invoice).toBeUndefined();
      const saved = await v.db
        .select()
        .from(billPayments)
        .where(eq(billPayments.id, first.payment.id));
      v.set("2026-10-14T23:30:00.000Z");
      const second = await take(
        v.deps,
        v.cfg,
        id,
        await v.request(id, method, "12.10"),
        v.operator,
      );
      expect(second.invoice).toBeDefined();
      expect(await v.facts(id)).toEqual(night);
      expect(recordFacts(id)).toEqual([
        { day: "15-10-2026", generation: "2026-10-15T01:30:00+02:00" },
      ]);
      expect(
        await v.db.select().from(billPayments).where(eq(billPayments.id, first.payment.id)),
      ).toEqual(saved);
      if (kind !== "reader") expect(saved[0]!.receivedAt).toBe("2026-10-14T21:59:59.000Z");
    },
  );
  it.each(["cash", "reader"])(
    "replays settled %s without a current clock or open admission",
    async (kind) => {
      const id = await v.bill();
      const req = await v.request(id, kind === "cash" ? "cash" : "card");
      const take = kind === "cash" ? takeBillPayment : takeReaderBillPayment;
      const paid = await take(v.deps, v.cfg, id, req, v.operator);
      const before = v.snapshot(),
        calls = v.card.collectCalls.length;
      const clock = {
        ...v.deps.clock,
        now: () => {
          throw new Error("a replay must not read the clock");
        },
      };
      const replay = await take(
        { ...v.deps, clock, admission: close("invalid") },
        v.cfg,
        id,
        req,
        v.operator,
      );
      expect(replay.payment).toEqual(paid.payment);
      expect(replay.invoice).toEqual(paid.invoice);
      expect(v.snapshot()).toEqual(before);
      expect(v.card.collectCalls).toHaveLength(calls);
    },
  );
  it.each([
    [
      "midnight",
      "2026-10-14T21:59:59.000Z",
      "2026-10-14T22:00:01.000Z",
      120,
      "15-10-2026",
      "2026-10-15T00:00:01+02:00",
    ],
    [
      "spring",
      "2026-03-29T00:59:59.000Z",
      "2026-03-29T01:00:01.000Z",
      120,
      "29-03-2026",
      "2026-03-29T03:00:01+02:00",
    ],
    [
      "autumn",
      "2026-10-25T00:59:59.000Z",
      "2026-10-25T01:00:01.000Z",
      60,
      "25-10-2026",
      "2026-10-25T02:00:01+01:00",
    ],
  ] as const)(
    "uses finalization offset after a bill capture held across %s",
    async (_label, start, end, offset, day, generation) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(start));
      v.set(start);
      const id = await v.bill(),
        req = await v.request(id, "card");
      const original = v.card.collect.bind(v.card);
      const collect = vi.spyOn(v.card, "collect").mockImplementation(async (input) => {
        const answer = await original(input);
        await withTransaction(v.db, async (tx) => {
          expect(
            (await tx.select().from(billPayments).where(eq(billPayments.workingOrderId, id)))[0]!
              .state,
          ).toBe("pending");
        });
        v.set(end);
        vi.setSystemTime(new Date(end));
        return answer;
      });
      try {
        await takeReaderBillPayment(v.deps, v.cfg, id, req, v.operator);
        expect(await v.facts(id)).toEqual([{ instant: end, offset }]);
        expect(recordFacts(id)).toEqual([{ day, generation }]);
        const [received] = await v.db
          .select()
          .from(billPayments)
          .where(eq(billPayments.workingOrderId, id));
        const [capture] = await v.db
          .select()
          .from(payments)
          .where(eq(payments.billPaymentId, received!.id));
        expect(received!.receivedAt).toBe(start);
        expect(capture!.settledAt).toBe(start);
        expect(capture!.amount).toBe(2420);
      } finally {
        collect.mockRestore();
        vi.useRealTimers();
      }
    },
  );
  for (const state of ["unchecked", "missing", "invalid", "restart_required"]) {
    it.each(["cash", "manual", "reader"])(
      `${state} refuses %s preparation before writing or collecting`,
      async (kind) => {
        const id = await v.bill();
        const req = await v.request(id, kind === "cash" ? "cash" : "card");
        const before = v.snapshot();
        const calls = v.card.collectCalls.length;
        const take = kind === "reader" ? takeReaderBillPayment : takeBillPayment;
        v.db.run(
          sql`create trigger zone_payment_insert before insert on bill_payments begin select raise(abort, 'unexpected payment insert'); end`,
        );
        try {
          await expect(
            take({ ...v.deps, admission: close(state) }, v.cfg, id, req, v.operator),
          ).rejects.toMatchObject({ code: "venue.time_zone_not_ready", params: { reason: state } });
        } finally {
          v.db.run(sql`drop trigger zone_payment_insert`);
        }
        expect(v.card.collectCalls).toHaveLength(calls);
        expect(v.snapshot()).toEqual(before);
      },
    );
  }
  it("refuses a reader conversion failure before its provider call", async () => {
    const id = await v.bill();
    const req = await v.request(id, "card");
    const before = v.snapshot(),
      calls = v.card.collectCalls.length;
    const clock = {
      ...v.deps.clock,
      now: () => ({ ...v.deps.clock.now(), instant: new Date(NaN) }),
    };
    await expect(
      takeReaderBillPayment({ ...v.deps, clock }, v.cfg, id, req, v.operator),
    ).rejects.toMatchObject({ code: "venue.time_zone_conversion_failed" });
    expect(v.card.collectCalls).toHaveLength(calls);
    expect(v.snapshot()).toEqual(before);
  });
  it("refuses a formatter failure before its reader receives any collection request", async () => {
    const id = await v.bill();
    const req = await v.request(id, "card");
    const before = v.snapshot(),
      calls = v.card.collectCalls.length;
    const formatter = vi
      .spyOn(Intl.DateTimeFormat.prototype, "formatToParts")
      .mockImplementation(() => {
        throw new Error("formatter unavailable");
      });
    try {
      await expect(takeReaderBillPayment(v.deps, v.cfg, id, req, v.operator)).rejects.toThrow(
        "formatter unavailable",
      );
      expect(v.card.collectCalls).toHaveLength(calls);
      expect(v.snapshot()).toEqual(before);
    } finally {
      formatter.mockRestore();
    }
  });
  it("preserves a provider decline if admission closes before its final transaction", async () => {
    const id = await v.bill();
    const req = await v.request(id, "card");
    const admission = new TradingAdmission();
    admission.admit();
    const original = v.card.collect.bind(v.card);
    let evidence: ReturnType<typeof v.snapshot>;
    v.card.failNextCollect();
    const collect = vi.spyOn(v.card, "collect").mockImplementation(async (input) => {
      const answer = await original(input);
      evidence = v.snapshot();
      admission.requireRestart();
      return answer;
    });
    try {
      await expect(
        takeReaderBillPayment({ ...v.deps, admission }, v.cfg, id, req, v.operator),
      ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
      expect(v.snapshot()).toEqual(evidence!);
    } finally {
      collect.mockRestore();
    }
  });
  it("checks completion admission before the payment update even if issuance is bypassed", async () => {
    const id = await v.bill();
    const p = await v.pending(id);
    v.db.run(
      sql`create trigger zone_payment_update before update on bill_payments begin select raise(abort, 'unexpected payment update'); end`,
    );
    try {
      await expect(
        guardedTransaction((tx) =>
          completeBillPayment(
            tx,
            { ...v.deps, admission: close("invalid") },
            v.cfg,
            p.id,
            new Date(),
          ),
        ),
      ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
    } finally {
      v.db.run(sql`drop trigger zone_payment_update`);
    }
  });
  it("retains a capture when admission closes during collection and completes it once after admission", async () => {
    const id = await v.bill();
    const req = await v.request(id, "card");
    const admission = new TradingAdmission();
    admission.admit();
    const original = v.card.collect.bind(v.card);
    let capture: ReturnType<typeof v.snapshot>;
    const spy = vi.spyOn(v.card, "collect").mockImplementation(async (input) => {
      const answer = await original(input);
      capture = v.snapshot();
      admission.repairOnly("invalid");
      return answer;
    });
    try {
      await expect(
        takeReaderBillPayment({ ...v.deps, admission }, v.cfg, id, req, v.operator),
      ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
      expect(v.snapshot()).toEqual(capture!);
    } finally {
      spy.mockRestore();
    }
    const before = v.card.collectCalls.length;
    expect((await settlePendingBillPayments(v.deps)).received).toBeGreaterThanOrEqual(1);
    const saved = v.snapshot();
    await settlePendingBillPayments(v.deps);
    expect(v.snapshot()).toEqual(saved);
    expect(v.card.collectCalls).toHaveLength(before);
    expect(await v.facts(id)).toEqual(night);
  });
  it.each(["unchecked", "missing", "invalid", "restart_required"])(
    "%s refuses the worker pass and preserves a retained capture",
    async (state) => {
      const id = await v.bill();
      await v.pending(id);
      const before = v.snapshot();
      await expect(
        settlePendingBillPayments({ ...v.deps, admission: close(state) }),
      ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
      expect(v.snapshot()).toEqual(before);
      expect((await settlePendingBillPayments(v.deps)).received).toBeGreaterThanOrEqual(1);
      expect(await v.facts(id)).toEqual(night);
    },
  );
  it("rechecks the worker transaction after its pass started", async () => {
    const id = await v.bill();
    const p = await v.pending(id, false);
    const before = v.snapshot();
    await expect(
      withTransaction(v.db, (tx) =>
        settleFromProviderRow(
          tx,
          { ...v.deps, admission: close("invalid") },
          p.id,
          new Date(),
          "stored",
        ),
      ),
    ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
    expect(v.snapshot()).toEqual(before);
  });
  it("refuses a partial cash refund before its row, attendance or drawer write", async () => {
    const id = await v.bill();
    const paid = await takeBillPayment(
      v.deps,
      v.cfg,
      id,
      await v.request(id, "cash", "12.10"),
      v.operator,
    );
    const before = v.snapshot();
    await expect(
      refundBillPayment(
        { ...v.deps, admission: close("invalid") },
        v.cfg,
        id,
        paid.payment.id,
        {
          submissionId: randomUUID(),
          appliedAmount: "1.00",
          tipAmount: "0.00",
          reason: "Goodwill",
        },
        v.operator,
        "cash",
      ),
    ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
    expect(v.snapshot()).toEqual(before);
  });
  it.each(["resolve", "attest"])(
    "manager %s uses finalization time and preserves the provider settlement",
    async (action) => {
      const id = await v.bill();
      const p = await v.pending(id);
      const session = await withTransaction(v.db, (tx) =>
        startManagementSession(tx, { personId: v.adminId }),
      );
      const app = new Hono();
      mountPaymentsApi(
        app,
        {
          ...v.deps,
          providers: [],
          ring: loadKeyRing({
            WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
            WAITRON_CREDENTIALS_KEY_VERSION: "1",
          }),
          environment: "preproduction",
        },
        () => {},
      );
      const evidence = await v.db.select().from(payments).where(eq(payments.billPaymentId, p.id));
      const out = await send(
        app,
        `${MANAGEMENT_COOKIE}=${session.token}`,
        "POST",
        `/management-api/payments/bill-payments/${p.id}/${action}`,
        action === "resolve"
          ? {}
          : { outcome: "received", pin: "1234", note: "Provider confirmed this payment" },
      );
      expect(out).toMatchObject({ status: 200, json: { outcome: "received" } });
      expect(await v.facts(id)).toEqual(night);
      const [row] = await v.db.select().from(billPayments).where(eq(billPayments.id, p.id));
      expect(row!.receivedAt).toBe("2026-10-14T21:59:59.000Z");
      expect(
        (await v.db.select().from(payments).where(eq(payments.billPaymentId, p.id)))[0],
      ).toEqual({ ...evidence[0], saleId: expect.any(String), updatedAt: expect.any(String) });
    },
  );
});
