import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { billPaymentOfRow, seedBillPayment } from "@waitron/payments/test/seed.js";
import { setup } from "./testing/setup.js";
import { SumUpCloudProvider, cardFromTransaction, mapEntryMode } from "./provider.js";
import type { SumUpClient } from "./client.js";

describe("SumUp card details mapping", () => {
  it("maps SumUp entry modes to the four normalised values", () => {
    expect(mapEntryMode("contactless")).toBe("contactless");
    expect(mapEntryMode("chip")).toBe("chip");
    expect(mapEntryMode("magstripe")).toBe("swipe");
    expect(mapEntryMode("swipe")).toBe("swipe");
    expect(mapEntryMode("something_new")).toBe("unknown");
    expect(mapEntryMode(undefined)).toBe("unknown");
  });

  it("builds CardDetails from a transaction that carries the fields", () => {
    expect(
      cardFromTransaction({
        id: "t1",
        status: "SUCCESSFUL",
        amount: decimal("1.00"),
        card: { last4: "5838", type: "VISA_ELECTRON" },
        entryMode: "contactless",
        authCode: "328600",
      }),
    ).toEqual({
      scheme: "VISA ELECTRON",
      last4: "5838",
      entryMode: "contactless",
      authCode: "328600",
    });
  });

  it("returns undefined when the transaction carries no card object", () => {
    expect(
      cardFromTransaction({ id: "t2", status: "SUCCESSFUL", amount: decimal("1.00") }),
    ).toBeUndefined();
  });

  it("returns undefined for a malformed last4 (not exactly four digits) so it never reaches the store", () => {
    expect(
      cardFromTransaction({
        id: "t2b",
        status: "SUCCESSFUL",
        amount: decimal("1.00"),
        card: { last4: "58380", type: "VISA" },
      }),
    ).toBeUndefined();
  });

  it("still builds a block when auth_code is missing (null), never throwing", () => {
    expect(
      cardFromTransaction({
        id: "t3",
        status: "SUCCESSFUL",
        amount: decimal("1.00"),
        card: { last4: "6017", type: "VISA" },
        entryMode: "chip",
      }),
    ).toEqual({ scheme: "VISA", last4: "6017", entryMode: "chip", authCode: null });
  });
});

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  timeoutMs: 60_000,
});

describe("SumUpCloudProvider.collect", () => {
  it("captures: T1 attempting → checkout keyed by our payment_ref → poll → T2 captured with SumUp's transaction id", async () => {
    const { fake, provider, params, row } = await setup(suite);
    const result = await provider.collect(params);
    expect(result).toMatchObject({
      provider: "sumup",
      state: "captured",
      amount: decimal("12.50"),
    });
    expect(result.settledAt).toBeInstanceOf(Date);
    expect(fake.lastCreate).toMatchObject({
      readerId: "rdr_1",
      currency: "EUR",
      amount: decimal("12.50"),
      foreignTransactionId: result.paymentRef,
    });
    const r = await row(result.paymentRef);
    expect(r.state).toBe("captured");
    expect(r.externalRef).toMatch(/^txn_/); // the REFUNDABLE id, not the ctx_ poll key
  });

  it("a declined card resolves failed with settledAt null", async () => {
    const { provider, params, row } = await setup(suite, (f) => f.declineNext());
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "failed", settledAt: null });
    expect((await row(result.paymentRef)).state).toBe("failed");
  });

  it("a cancelled checkout resolves failed", async () => {
    const { provider, params } = await setup(suite, (f) => f.cancelNext());
    expect((await provider.collect(params)).state).toBe("failed");
  });

  it("a definite 4xx refusal of the create resolves failed (the reader never woke)", async () => {
    const { provider, params, row } = await setup(suite, (f) => f.refuseNext());
    const result = await provider.collect(params);
    expect(result.state).toBe("failed");
    expect((await row(result.paymentRef)).state).toBe("failed");
  });

  it("a network error on the create leaves the row attempting (we do not know whether SumUp accepted it)", async () => {
    const { provider, params, row } = await setup(suite, (f) => f.throwOnCreateNext());
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "attempting", settledAt: null });
    expect((await row(result.paymentRef)).state).toBe("attempting");
  });

  it("a poll timeout leaves the row attempting with the ctx poll key stamped, and never calls terminate", async () => {
    const { provider, params, row } = await setup(suite, (f) => f.stallNext());
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "attempting", settledAt: null });
    const r = await row(result.paymentRef);
    expect(r.state).toBe("attempting");
    expect(r.externalRef).toMatch(/^ctx_/);
  });

  it("a transaction SumUp cannot find yet is still pending, not an error", async () => {
    const { provider, params } = await setup(suite, (f) => {
      f.stallNext();
      f.invisibleUntilSettled();
    });
    expect((await provider.collect(params)).state).toBe("attempting");
  });

  it("a network error mid-poll leaves the row attempting", async () => {
    const { provider, params } = await setup(suite, (f) => f.throwOnFindNext());
    expect((await provider.collect(params)).state).toBe("attempting");
  });

  it("REFUNDED during collect is not a basis for T2: the row stays attempting for the sweep", async () => {
    const { provider, params, row } = await setup(suite, (f) => f.resolveOnFirstFind("REFUNDED"));
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "attempting", settledAt: null });
    expect((await row(result.paymentRef)).state).toBe("attempting");
  });

  it("a captured collect result carries the card block from the transaction", async () => {
    const { provider, params } = await setup(suite);
    const result = await provider.collect(params);
    expect(result.state).toBe("captured");
    expect(result.card).toEqual({
      scheme: "VISA",
      last4: "5838",
      entryMode: "contactless",
      authCode: "328600",
    });
  });

  it("captures without failing when the transaction has no card fields (card undefined, never throws)", async () => {
    const { provider, params } = await setup(suite, (f) => f.cardNext(null));
    const result = await provider.collect(params);
    expect(result.state).toBe("captured");
    expect(result.card).toBeUndefined();
  });

  it("a SUCCESSFUL transaction with a malformed last4 still captures — the card block is dropped, never the charge", async () => {
    // A 5-char last4 would trip `payments_card_last4_ck` and block the capture write. The adapter
    // must drop malformed card facts so the capture persists with card columns null (CLAUDE.md §5).
    const { provider, params, row } = await setup(suite, (f) =>
      f.cardNext({
        card: { last4: "58380", type: "VISA" },
        entryMode: "contactless",
        authCode: "328600",
      }),
    );
    const result = await provider.collect(params);
    expect(result.state).toBe("captured");
    expect(result.card).toBeUndefined();
    const r = await row(result.paymentRef);
    expect(r.state).toBe("captured");
    expect(r.cardLast4).toBeNull();
    expect(r.cardScheme).toBeNull();
  });
});

describe("SumUpCloudProvider.collect for a bill payment", () => {
  it("names the bill payment on the row it commits before calling SumUp", async () => {
    const { t, provider, params, row } = await setup(suite, (f) => f.throwOnCreateNext());
    const billPaymentId = await seedBillPayment(suite.db, t);

    const result = await provider.collect({ ...params, billPaymentId });

    expect((await row(result.paymentRef)).state).toBe("attempting");
    expect(await billPaymentOfRow(suite.db, result.paymentRef)).toBe(billPaymentId);
  });

  it("keeps the bill payment on the row it captures", async () => {
    const { t, provider, params } = await setup(suite);
    const billPaymentId = await seedBillPayment(suite.db, t);

    const result = await provider.collect({ ...params, billPaymentId });

    expect(result.state).toBe("captured");
    expect(await billPaymentOfRow(suite.db, result.paymentRef)).toBe(billPaymentId);
  });
});

describe("SumUpCloudProvider default poll", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits one second between polls when no poll is injected", async () => {
    const { fake, params, row } = await setup(suite, (f) => f.stallNext());
    const provider = new SumUpCloudProvider({
      client: fake,
      db: suite.db,
      nodeId: "11111111-1111-4111-8111-111111111111",
      incidents: () => Promise.resolve(true),
    });
    const find = vi.spyOn(fake, "findTransaction");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let done = false;
    const collecting = provider.collect(params).then((result) => {
      done = true;
      return result;
    });
    // Wait (on the real setImmediate) until the first poll has come back PENDING and its sleep is armed.
    while (vi.getTimerCount() === 0 && !done) await new Promise<void>((r) => setImmediate(r));
    expect(find).toHaveBeenCalledTimes(1);
    const query = find.mock.calls[0]![0] as { clientTransactionId: string };
    fake.settle(query.clientTransactionId);

    await vi.advanceTimersByTimeAsync(999);
    expect(find).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(find).toHaveBeenCalledTimes(2);
    const result = await collecting;
    expect(result.state).toBe("captured");
    expect((await row(result.paymentRef)).state).toBe("captured");
  });
});

describe("SumUpCloudProvider.forward", () => {
  it("forward is a no-op for the server-driven cloud provider (no device-local offline queue)", async () => {
    // All-zeros without touching the database — the cloud reader has no store-and-forward queue.
    const { provider } = await setup(suite);
    expect(await provider.forward(new Date("2026-07-24T10:00:00Z"))).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});

describe("SumUpCloudProvider.sendRefund and lookupRefund", () => {
  /** A captured SumUp transaction the refunds address. */
  async function refundable(tune?: Parameters<typeof setup>[1]) {
    const s = await setup(suite, tune);
    const collected = await s.provider.collect(s.params);
    const transactionId = (await s.row(collected.paymentRef))!.externalRef!;
    return { ...s, transactionId };
  }
  const request = (processorRef: string, amount = "4.00") => ({
    processorRef,
    amount: decimal(amount),
    idempotencyKey: "bpr_unused",
    refundId: "r-1",
  });
  const query = (
    processorRef: string,
    over: Partial<{ amount: string; sentAt: Date; excludeRefs: string[] }> = {},
  ) => ({
    processorRef,
    refundId: "r-1",
    amount: decimal(over.amount ?? "4.00"),
    sentAt: over.sentAt ?? new Date("2026-09-27T10:00:00.000Z"),
    excludeRefs: over.excludeRefs ?? [],
  });

  it("answers SumUp's 201, which names no refund, as accepted, asking for the exact amount", async () => {
    const { fake, provider, transactionId } = await refundable();

    expect(await provider.sendRefund(request(transactionId, "4.10"))).toEqual({ kind: "accepted" });
    expect(fake.sendRefundCalls).toEqual([{ transactionId, amount: decimal("4.10") }]);
  });

  it.each([400, 403, 404, 409, 422])(
    "answers %i as a refusal SumUp documents as no refund made",
    async (httpStatus) => {
      const { fake, provider, transactionId } = await refundable();
      fake.scriptNextSendRefund({ httpStatus });
      expect(await provider.sendRefund(request(transactionId))).toEqual({
        kind: "refused",
        httpStatus,
        documented: true,
      });
    },
  );

  it.each([401, 429])(
    "answers %i, which SumUp does not document for a refund, as a refusal that settles nothing",
    async (httpStatus) => {
      const { fake, provider, transactionId } = await refundable();
      fake.scriptNextSendRefund({ httpStatus });
      expect(await provider.sendRefund(request(transactionId))).toEqual({
        kind: "refused",
        httpStatus,
        documented: false,
      });
    },
  );

  it.each([500, 503])("answers %i as uncertain", async (httpStatus) => {
    const { fake, provider, transactionId } = await refundable();
    fake.scriptNextSendRefund({ httpStatus });
    expect(await provider.sendRefund(request(transactionId))).toEqual({
      kind: "uncertain",
      reason: "server_error",
      httpStatus,
    });
  });

  it("answers no answer as uncertain, a timed-out one as a timeout", async () => {
    const { provider, transactionId } = await refundable();
    const timedOut = new SumUpCloudProvider({
      client: {
        ...({} as SumUpClient),
        sendRefund: () => Promise.reject(new DOMException("aborted", "AbortError")),
      },
      db: suite.db,
      nodeId: "n",
      incidents: () => Promise.resolve(true),
    });
    const lost = new SumUpCloudProvider({
      client: {
        ...({} as SumUpClient),
        sendRefund: () => Promise.reject(new TypeError("fetch failed")),
      },
      db: suite.db,
      nodeId: "n",
      incidents: () => Promise.resolve(true),
    });

    expect(await timedOut.sendRefund(request(transactionId))).toEqual({
      kind: "uncertain",
      reason: "timeout",
    });
    expect(await lost.sendRefund(request(transactionId))).toEqual({
      kind: "uncertain",
      reason: "network",
    });
    expect(provider.refundResendWindowMs).toBeNull();
  });

  it.each([
    ["REFUNDED", "completed"],
    ["SUCCESSFUL", "completed"],
    ["FAILED", "failed"],
    ["PENDING", "pending"],
    ["A_STATUS_SUMUP_ADDS", "pending"],
  ] as const)("maps a matching REFUND event %s to %s", async (status, outcome) => {
    const { fake, provider, transactionId } = await refundable();
    fake.addRefundEvent(transactionId, {
      id: "501",
      status,
      amount: decimal("4.00"),
      timestamp: "2026-09-27T10:00:03.000Z",
    });

    expect(await provider.lookupRefund(query(transactionId))).toEqual({
      kind: "match",
      providerRefundRef: "501",
      outcome,
      providerStatus: status,
    });
  });

  it("matches only an event of the same amount, not already recorded, made after the send less the clock allowance", async () => {
    const { fake, provider, transactionId } = await refundable();
    const at = (iso: string, id: string, amount = "4.00") =>
      fake.addRefundEvent(transactionId, {
        id,
        status: "REFUNDED",
        amount: decimal(amount),
        timestamp: iso,
      });
    at("2026-09-27T09:57:59.000Z", "too-early");
    at("2026-09-27T10:00:01.000Z", "other-amount", "4.01");
    at("2026-09-27T10:00:02.000Z", "ours-before");
    at("2026-09-27T09:58:30.000Z", "box-clock-ahead");

    const found = await provider.lookupRefund(
      query(transactionId, { excludeRefs: ["ours-before"] }),
    );

    expect(found).toEqual({
      kind: "match",
      providerRefundRef: "box-clock-ahead",
      outcome: "completed",
      providerStatus: "REFUNDED",
    });
  });

  it("answers two candidate events as ambiguous, none as none, and SumUp unreachable as unreachable", async () => {
    const { fake, provider, transactionId } = await refundable();
    const none = await provider.lookupRefund(query(transactionId));
    for (const id of ["a", "b"]) {
      fake.addRefundEvent(transactionId, {
        id,
        status: "REFUNDED",
        amount: decimal("4.00"),
        timestamp: "2026-09-27T10:00:05.000Z",
      });
    }
    const two = await provider.lookupRefund(query(transactionId));
    fake.throwOnFindNext();
    const unreachable = await provider.lookupRefund(query(transactionId));

    expect(none).toEqual({ kind: "none" });
    expect(two).toEqual({ kind: "ambiguous", candidates: 2 });
    expect(unreachable).toEqual({ kind: "unreachable" });
  });

  it("finds its own send, in euros converted at the client, through a 201 and a lookup", async () => {
    const { fake, provider, transactionId } = await refundable();
    fake.eventClock = () => new Date("2026-09-27T10:00:01.500Z");
    await provider.sendRefund(request(transactionId, "0.40"));

    expect(await provider.lookupRefund(query(transactionId, { amount: "0.40" }))).toMatchObject({
      kind: "match",
      outcome: "completed",
    });
  });
});
