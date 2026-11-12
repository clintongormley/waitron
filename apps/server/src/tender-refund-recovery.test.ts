import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { billPaymentRefunds, incidents, tenderRefunds, tenders, sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { payments } from "@waitron/payments";
import { zonePaymentVenue } from "./testing/zone-payment-venue.js";
import { takeReaderBillPayment } from "./bill-payments.js";
import { refundBillPayment, resumeCardRefund, attestCardRefund } from "./bill-refunds.js";
import { beginSettledTenderRefund } from "./tender-refunds.js";
import {
  resumeTenderRefund,
  attestTenderRefund,
  stopTenderRefundResolvers,
  startTenderRefundResolvers,
} from "./tender-refund-sends.js";
import { recoverTenderRefunds, runTenderRefundRecoveryLoop } from "./tender-refund-recovery.js";
import { TradingAdmission } from "./trading-admission.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";

let v: Awaited<ReturnType<typeof zonePaymentVenue>>;
useVenueDb({
  resetPerTest: false,
  timeoutMs: 60_000,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    v = await zonePaymentVenue(db);
  },
});
beforeEach(() => {
  v.set("2026-10-14T23:30:00.000Z");
  startTenderRefundResolvers(v.db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await stopTenderRefundResolvers(v.db);
});
function closed(state: string) {
  const admission = new TradingAdmission();
  if (state === "invalid" || state === "missing") admission.repairOnly(state);
  if (state === "restart_required") admission.requireRestart();
  return admission;
}
async function target() {
  const id = await v.bill();
  await takeReaderBillPayment(v.deps, v.cfg, id, await v.request(id, "card"), v.operator);
  const [sale] = await v.db.select().from(sales).where(eq(sales.workingOrderId, id));
  const [tender] = await v.db.select().from(tenders).where(eq(tenders.saleId, sale!.id));
  const [payment] = await v.db.select().from(payments).where(eq(payments.saleId, sale!.id));
  return { id, sale: sale!, tender: tender!, payment: payment! };
}
async function retained(sent = false, createdAt?: string) {
  const t = await target();
  const [refund] = await v.db
    .insert(tenderRefunds)
    .values({
      saleId: t.sale.id,
      tenderId: t.tender.id,
      submissionId: randomUUID(),
      fingerprint: "worker-refund",
      appliedAmount: 100,
      tipAmount: 0,
      reason: "Goodwill",
      authorizedBy: v.adminId,
      requestedBy: v.adminId,
      ...v.cfg.origin,
      nodeId: v.cfg.nodeId,
      locationId: v.cfg.locationId,
      method: "card",
      provider: "fake",
      providerPaymentRef: t.payment.paymentRef,
      state: "pending",
      sentAt: sent ? "2026-10-14T23:29:00.000Z" : null,
      sendCount: sent ? 1 : 0,
      ...(createdAt === undefined ? {} : { createdAt }),
    })
    .returning();
  return { ...t, refund: refund! };
}
async function billRefund() {
  const id = await v.bill();
  const p = await takeReaderBillPayment(
    v.deps,
    v.cfg,
    id,
    await v.request(id, "card", "12.10"),
    v.operator,
  );
  return {
    id,
    paymentId: p.payment.id,
    request: {
      submissionId: randomUUID(),
      appliedAmount: "1.00",
      tipAmount: "0.00",
      reason: "Goodwill",
    },
  };
}
describe("settled tender recovery admission", () => {
  it.each(["unchecked", "missing", "invalid", "restart_required"])(
    "%s refuses a worker pass without changing saved refund evidence",
    async (state) => {
      const t = await retained();
      const before = v.snapshot();
      await expect(
        recoverTenderRefunds({ ...v.deps, admission: closed(state) }),
      ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
      expect(v.snapshot()).toEqual(before);
      await recoverTenderRefunds(v.deps);
      expect(
        (await v.db.select().from(tenderRefunds).where(eq(tenderRefunds.id, t.refund.id)))[0],
      ).toEqual({
        ...t.refund,
        state: "failed",
        failedAt: "2026-10-14T23:30:00.000Z",
        nextRetryAt: null,
      });
      const saved = v.snapshot();
      await recoverTenderRefunds(v.deps);
      expect(v.snapshot()).toEqual(saved);
    },
  );
  it.each(["retry", "manager", "loop"] as const)(
    "closed direct %s cannot look up or send a refund",
    async (resolver) => {
      const t = await retained(true),
        before = v.snapshot();
      const lookups = v.card.lookupCalls.length,
        sends = v.card.refundCalls.length;
      await expect(
        resumeTenderRefund({ ...v.deps, admission: closed("invalid") }, t.refund.id, resolver),
      ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
      expect(v.snapshot()).toEqual(before);
      expect(v.card.lookupCalls).toHaveLength(lookups);
      expect(v.card.refundCalls).toHaveLength(sends);
    },
  );
  it("checks its scheduling transaction after pass admission", async () => {
    const t = await retained();
    const before = v.snapshot();
    const admission = new TradingAdmission();
    admission.admit();
    const original = v.db.withWriteLock.bind(v.db);
    const boundary = vi.spyOn(v.db, "withWriteLock").mockImplementation((body) => {
      admission.repairOnly("invalid");
      return original(body);
    });
    try {
      await expect(recoverTenderRefunds({ ...v.deps, admission })).rejects.toMatchObject({
        errors: expect.arrayContaining([
          expect.objectContaining({ code: "venue.time_zone_not_ready" }),
        ]),
      });
    } finally {
      boundary.mockRestore();
    }
    expect(v.snapshot()).toEqual(before);
    expect(
      (await v.db.select().from(tenderRefunds).where(eq(tenderRefunds.id, t.refund.id)))[0],
    ).toEqual(t.refund);
  });
  it("preserves pending evidence when admission closes during a provider lookup", async () => {
    const t = await retained(true),
      before = v.snapshot();
    const admission = new TradingAdmission();
    admission.admit();
    const lookup = vi.spyOn(v.card, "lookupRefund").mockImplementation(async () => {
      admission.repairOnly("invalid");
      return {
        kind: "match",
        providerRefundRef: randomUUID(),
        outcome: "completed",
        providerStatus: "completed",
      };
    });
    try {
      await expect(
        resumeTenderRefund({ ...v.deps, admission }, t.refund.id, "loop"),
      ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
    } finally {
      lookup.mockRestore();
    }
    const current = await v.db
      .select()
      .from(tenderRefunds)
      .where(eq(tenderRefunds.id, t.refund.id));
    expect(current[0]).toEqual({ ...t.refund, lastLookupAt: "2026-10-14T23:30:00.000Z" });
    const after = v.snapshot();
    expect(after.payment_refunds).toEqual(before.payment_refunds);
  });
  it("refuses tender attestation and initial reservation while closed", async () => {
    const t = await retained(true),
      fresh = await target(),
      before = v.snapshot(),
      deps = { ...v.deps, admission: closed("invalid") };
    await expect(
      attestTenderRefund(deps, t.refund.id, "completed", {
        attestedBy: v.adminId,
        note: "Provider confirmed",
      }),
    ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
    await expect(
      beginSettledTenderRefund(
        deps,
        v.cfg,
        fresh.sale.id,
        {
          submissionId: randomUUID(),
          tenderId: fresh.tender.id,
          appliedAmount: "1.00",
          tipAmount: "0.00",
          reason: "Goodwill",
        },
        v.operator,
      ),
    ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
    expect(v.snapshot()).toEqual(before);
  });
  it("keeps the loop's primary predicate and awaits its resolver shutdown", async () => {
    const t = await retained();
    const before = v.snapshot();
    const controller = new AbortController();
    const errors: unknown[] = [];
    await runTenderRefundRecoveryLoop({
      ...v.deps,
      signal: controller.signal,
      isPrimary: () => false,
      onError: (error) => errors.push(error),
      sleep: async () => {
        controller.abort();
      },
    });
    expect(errors).toEqual([]);
    expect(v.snapshot()).toEqual(before);
    expect(
      (await v.db.select().from(tenderRefunds).where(eq(tenderRefunds.id, t.refund.id)))[0],
    ).toEqual(t.refund);
  });
});

describe("settled tender recovery stopping", () => {
  it.each([true, false])(
    "a signal stops before the next refund (signalled: %s)",
    async (signalled) => {
      await retained(true);
      await retained(true);
      const pending = async () =>
        (
          await v.db
            .select({ id: tenderRefunds.id })
            .from(tenderRefunds)
            .where(and(eq(tenderRefunds.state, "pending"), eq(tenderRefunds.method, "card")))
        ).map(({ id }) => id);
      // Sent and due: each one this pass would put to the provider.
      const waiting = (
        await v.db
          .select({ id: tenderRefunds.id })
          .from(tenderRefunds)
          .where(
            and(
              eq(tenderRefunds.state, "pending"),
              eq(tenderRefunds.method, "card"),
              isNotNull(tenderRefunds.sentAt),
              isNull(tenderRefunds.nextRetryAt),
            ),
          )
      ).map(({ id }) => id);
      const controller = new AbortController();
      const lookups = v.card.lookupCalls.length;
      const ask = v.card.lookupRefund.bind(v.card);
      vi.spyOn(v.card, "lookupRefund").mockImplementation(async (query) => {
        controller.abort();
        await ask(query);
        return {
          kind: "match",
          providerRefundRef: randomUUID(),
          outcome: "completed",
          providerStatus: "completed",
        };
      });
      await recoverTenderRefunds({
        ...v.deps,
        ...(signalled ? { stopSignal: controller.signal } : {}),
      });
      const asked = v.card.lookupCalls.slice(lookups).map((q) => q.refundId);
      expect(asked).toHaveLength(signalled ? 1 : waiting.length);
      const stillPending = await pending();
      expect(stillPending).toEqual(
        expect.arrayContaining(waiting.filter((id) => !asked.includes(id))),
      );
      for (const id of asked) {
        const [row] = await v.db.select().from(tenderRefunds).where(eq(tenderRefunds.id, id));
        expect(row!.state).toBe("completed");
      }
    },
  );
  it("a signal already raised asks about no refund and leaves its lookup time unwritten", async () => {
    const t = await retained(true);
    const lookups = v.card.lookupCalls.length;
    await recoverTenderRefunds({ ...v.deps, stopSignal: AbortSignal.abort() });
    expect(v.card.lookupCalls).toHaveLength(lookups);
    const [row] = await v.db.select().from(tenderRefunds).where(eq(tenderRefunds.id, t.refund.id));
    expect(row).toMatchObject({ state: "pending", lastLookupAt: null, sendCount: 1 });
  });
  it("the loop hands its own signal to its pass", async () => {
    await retained(true);
    await retained(true);
    const controller = new AbortController();
    const lookups = v.card.lookupCalls.length;
    const ask = v.card.lookupRefund.bind(v.card);
    vi.spyOn(v.card, "lookupRefund").mockImplementation(async (query) => {
      controller.abort();
      return ask(query);
    });
    const errors: unknown[] = [];
    await runTenderRefundRecoveryLoop({
      ...v.deps,
      signal: controller.signal,
      isPrimary: () => true,
      onError: (error) => errors.push(error),
      sleep: async () => {},
    });
    expect(errors).toEqual([]);
    expect(v.card.lookupCalls.slice(lookups)).toHaveLength(1);
  });
  it("an error other than the stop is still raised while stopping", async () => {
    const t = await retained(true);
    const controller = new AbortController();
    const admission = new TradingAdmission();
    admission.admit();
    vi.spyOn(v.card, "lookupRefund").mockImplementation(async () => {
      controller.abort();
      admission.repairOnly("invalid");
      return {
        kind: "match",
        providerRefundRef: randomUUID(),
        outcome: "completed",
        providerStatus: "completed",
      };
    });
    await expect(
      resumeTenderRefund(
        { ...v.deps, admission, stopSignal: controller.signal },
        t.refund.id,
        "loop",
      ),
    ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
  });
});
describe("bill refund admission", () => {
  it("refuses initial connected refund before reservation or provider call", async () => {
    const t = await billRefund(),
      before = v.snapshot(),
      sends = v.card.refundCalls.length;
    await expect(
      refundBillPayment(
        { ...v.deps, admission: closed("invalid") },
        v.cfg,
        t.id,
        t.paymentId,
        t.request,
        v.operator,
        "reader-card",
      ),
    ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
    expect(v.snapshot()).toEqual(before);
    expect(v.card.refundCalls).toHaveLength(sends);
  });
  it("retains a provider-refunded reservation while closed and resolves once when admitted", async () => {
    const t = await billRefund();
    const admission = new TradingAdmission();
    admission.admit();
    const original = v.card.sendRefund.bind(v.card);
    const send = vi.spyOn(v.card, "sendRefund").mockImplementation(async (input) => {
      const out = await original(input);
      admission.repairOnly("invalid");
      return out;
    });
    try {
      await expect(
        refundBillPayment(
          { ...v.deps, admission },
          v.cfg,
          t.id,
          t.paymentId,
          t.request,
          v.operator,
          "reader-card",
        ),
      ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
    } finally {
      send.mockRestore();
    }
    const [refund] = await v.db
      .select()
      .from(billPaymentRefunds)
      .where(eq(billPaymentRefunds.billPaymentId, t.paymentId));
    expect(refund).toMatchObject({ state: "pending", completedAt: null, sendCount: 1 });
    const before = v.snapshot(),
      calls = v.card.lookupCalls.length;
    await expect(
      resumeCardRefund({ ...v.deps, admission: closed("invalid") }, refund!.id, "loop", "stored"),
    ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
    await expect(
      attestCardRefund({ ...v.deps, admission: closed("invalid") }, refund!.id, "completed", {
        attestedBy: v.adminId,
        note: "Provider confirmed",
      }),
    ).rejects.toMatchObject({ code: "venue.time_zone_not_ready" });
    expect(v.snapshot()).toEqual(before);
    expect(v.card.lookupCalls).toHaveLength(calls);
    expect((await resumeCardRefund(v.deps, refund!.id, "loop", "stored")).refund.state).toBe(
      "completed",
    );
    const saved = v.snapshot();
    await resumeCardRefund(v.deps, refund!.id, "loop", "stored");
    expect(v.snapshot()).toEqual(saved);
  });
});
describe("bill refund recovery stopping", () => {
  it.each([true, false])(
    "a signal stops before the next bill refund's lookup (signalled: %s)",
    async (signalled) => {
      vi.spyOn(v.card, "sendRefund").mockResolvedValue({ kind: "uncertain", reason: "network" });
      for (let i = 0; i < 2; i++) {
        const t = await billRefund();
        await refundBillPayment(
          v.deps,
          v.cfg,
          t.id,
          t.paymentId,
          t.request,
          v.operator,
          "reader-card",
        );
      }
      const stateOf = async (id: string) =>
        (
          await v.db
            .select({ state: billPaymentRefunds.state })
            .from(billPaymentRefunds)
            .where(eq(billPaymentRefunds.id, id))
        )[0]!.state;
      // Sent and pending: each one this pass would ask its provider about.
      const waiting = (
        await v.db
          .select({ id: billPaymentRefunds.id })
          .from(billPaymentRefunds)
          .where(and(eq(billPaymentRefunds.state, "pending"), isNotNull(billPaymentRefunds.sentAt)))
      ).map(({ id }) => id);
      expect(waiting.length).toBeGreaterThanOrEqual(2);
      const controller = new AbortController();
      const asked: string[] = [];
      vi.spyOn(v.card, "lookupRefund").mockImplementation(async (query) => {
        asked.push(query.refundId);
        controller.abort();
        return {
          kind: "match",
          providerRefundRef: randomUUID(),
          outcome: "completed",
          providerStatus: "completed",
        };
      });
      await settlePendingBillPayments(
        { ...v.deps, cfg: v.cfg },
        signalled ? controller.signal : undefined,
      );
      expect(asked).toHaveLength(signalled ? 1 : waiting.length);
      expect(waiting).toEqual(expect.arrayContaining(asked));
      for (const id of waiting) {
        expect(await stateOf(id)).toBe(asked.includes(id) ? "completed" : "pending");
      }
    },
  );
  it.each([true, false])(
    "a signal raised while the provider is being loaded asks it nothing (signalled: %s)",
    async (signalled) => {
      vi.spyOn(v.card, "sendRefund").mockResolvedValue({ kind: "uncertain", reason: "network" });
      const t = await billRefund();
      await refundBillPayment(
        v.deps,
        v.cfg,
        t.id,
        t.paymentId,
        t.request,
        v.operator,
        "reader-card",
      );
      const waiting = (
        await v.db
          .select({ id: billPaymentRefunds.id })
          .from(billPaymentRefunds)
          .where(and(eq(billPaymentRefunds.state, "pending"), isNotNull(billPaymentRefunds.sentAt)))
      ).map(({ id }) => id);
      const controller = new AbortController();
      const asked: string[] = [];
      vi.spyOn(v.card, "lookupRefund").mockImplementation(async (query) => {
        asked.push(query.refundId);
        return {
          kind: "match",
          providerRefundRef: randomUUID(),
          outcome: "completed",
          providerStatus: "completed",
        };
      });
      const pass = await settlePendingBillPayments(
        {
          ...v.deps,
          cfg: v.cfg,
          refundProviderFor: async () => {
            controller.abort();
            return v.card;
          },
        },
        signalled ? controller.signal : undefined,
      );
      expect(asked).toHaveLength(signalled ? 0 : waiting.length);
      expect(pass.errors).toEqual([]);
      const rows = await v.db
        .select()
        .from(billPaymentRefunds)
        .where(eq(billPaymentRefunds.state, "pending"));
      expect(rows.map((row) => row.id)).toEqual(signalled ? expect.arrayContaining(waiting) : []);
      // Nothing of the stopped pass holds the refund: the next pass without a signal settles it.
      if (signalled) {
        await settlePendingBillPayments({ ...v.deps, cfg: v.cfg });
        expect(asked).toEqual(expect.arrayContaining(waiting));
      }
    },
  );
  it("a signal raised during a send the provider accepted leaves the refund sent and pending, unasked", async () => {
    const t = await billRefund();
    const controller = new AbortController();
    vi.spyOn(v.card, "sendRefund").mockImplementation(async () => {
      controller.abort();
      return { kind: "accepted" };
    });
    const asked: string[] = [];
    vi.spyOn(v.card, "lookupRefund").mockImplementation(async (query) => {
      asked.push(query.refundId);
      return {
        kind: "match",
        providerRefundRef: randomUUID(),
        outcome: "completed",
        providerStatus: "completed",
      };
    });
    await refundBillPayment(
      { ...v.deps, stopSignal: controller.signal },
      v.cfg,
      t.id,
      t.paymentId,
      t.request,
      v.operator,
      "reader-card",
    );
    const [saved] = await v.db
      .select()
      .from(billPaymentRefunds)
      .where(eq(billPaymentRefunds.billPaymentId, t.paymentId));
    expect(asked).toEqual([]);
    expect(saved).toMatchObject({ state: "pending", sendCount: 1 });
    expect(saved!.sentAt).not.toBeNull();
    await resumeCardRefund(v.deps, saved!.id, "loop", "stored");
    expect(asked).toEqual([saved!.id]);
    const [settled] = await v.db
      .select({ state: billPaymentRefunds.state })
      .from(billPaymentRefunds)
      .where(eq(billPaymentRefunds.id, saved!.id));
    expect(settled!.state).toBe("completed");
  });
});
describe("settled tender recovery while the start's time is unconfirmed", () => {
  it("leaves a pending refund untouched for a pass while waiting, and completes it once confirmed", async () => {
    const t = await retained(true);
    vi.spyOn(v.card, "lookupRefund").mockResolvedValue({
      kind: "match",
      providerRefundRef: randomUUID(),
      outcome: "completed",
      providerStatus: "completed",
    });
    let waiting = true;
    const deps = { ...v.deps, clockUnconfirmed: () => waiting };
    const before = v.snapshot();
    const lookups = v.card.lookupCalls.length;
    const asked = vi.mocked(v.card.lookupRefund).mock.calls.length;

    await recoverTenderRefunds(deps);

    expect(v.snapshot()).toEqual(before);
    expect(vi.mocked(v.card.lookupRefund).mock.calls.length).toBe(asked);
    expect(v.card.lookupCalls).toHaveLength(lookups);

    waiting = false;
    await recoverTenderRefunds(deps);

    const [row] = await v.db.select().from(tenderRefunds).where(eq(tenderRefunds.id, t.refund.id));
    expect(row!.state).toBe("completed");
  });
});
describe("settled tender recovery when recording the outcome throws", () => {
  it("still raises the unresolved alert after an hour and rejects with the attempt's error", async () => {
    const t = await retained(true, "2026-10-14T23:28:00.000Z");
    vi.spyOn(v.card, "lookupRefund").mockResolvedValue({
      kind: "match",
      providerRefundRef: randomUUID(),
      outcome: "completed",
      providerStatus: "completed",
    });
    const refusal = new Error("recording refused");
    const deps = {
      ...v.deps,
      attendance: async () => {
        throw refusal;
      },
    };
    v.set("2026-10-15T01:31:00.000Z");

    const failure = await recoverTenderRefunds(deps).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(new Set((failure as AggregateError).errors)).toEqual(new Set([refusal]));
    const raised = (await v.db.select().from(incidents)).filter(
      (incident) => (incident.params as { refundId?: string }).refundId === t.refund.id,
    );
    expect(raised).toMatchObject([{ code: "payment.tender_refund_unresolved" }]);
    const [row] = await v.db.select().from(tenderRefunds).where(eq(tenderRefunds.id, t.refund.id));
    expect(row!.state).toBe("pending");
  });
});
