import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { billPaymentRefunds, tenderRefunds, tenders, sales } from "@waitron/db";
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
async function retained(sent = false) {
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
