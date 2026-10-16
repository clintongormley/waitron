import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin, workingOrderId } from "@waitron/shared";
import {
  PAYMENTS_MIGRATIONS,
  countProviderCancelledResolutions,
  getPaymentByRef,
  insertAttempting,
} from "@waitron/payments";
import { seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { StripeTerminalProvider } from "./provider.js";
import { FakeStripe } from "./testing/fake-stripe.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
const now = new Date("2026-10-16T18:30:00Z");

function provider(client: FakeStripe): StripeTerminalProvider {
  return new StripeTerminalProvider({
    client,
    db: suite.db,
    poll: { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() },
  });
}

async function params() {
  const seeded = await seedWorkingOrder(suite.db);
  return {
    origin: deviceOrigin(seeded.deviceId),
    workingOrderId: workingOrderId(seeded.workingOrderId),
    amount: decimal("12.10"),
    readerRef: "reader_unknown",
  };
}

async function row(paymentRef: string) {
  return withTransaction(suite.db, (tx) => getPaymentByRef(tx, { provider: "stripe", paymentRef }));
}

describe("Stripe unknown outcomes", () => {
  it("does not count a stale listed row that a manager resolved while another row was checked", async () => {
    const client = new FakeStripe();
    const refs = [randomUUID(), randomUUID()];
    for (const [index, paymentRef] of refs.entries()) {
      const p = await params();
      client.setIntent(`pi_snapshot_${index}`, {
        status: index === 0 ? "succeeded" : "requires_payment_method",
        amount: 1210,
        amountReceived: index === 0 ? 1210 : 0,
      });
      await withTransaction(suite.db, (tx) =>
        insertAttempting(tx, {
          ...p,
          provider: "stripe",
          paymentRef,
          externalRef: `pi_snapshot_${index}`,
        }),
      );
    }
    const retrieve = client.retrievePaymentIntent.bind(client);
    vi.spyOn(client, "retrievePaymentIntent").mockImplementationOnce(async (id) => {
      expect(
        await provider(client).resolveAbandonedAttempt(refs[1]!, now, {
          personId: "22222222-2222-4222-8222-222222222222",
        }),
      ).toEqual({ outcome: "failed", cancelledAtProvider: true });
      return retrieve(id);
    });
    expect(await provider(client).resolvePending(now)).toEqual({
      nextDueAt: null,
      forwarded: 1,
      declined: 0,
      incidentsRaised: 0,
    });
    expect((await row(refs[0]!))?.state).toBe("captured");
    expect((await row(refs[1]!))?.state).toBe("failed");
    expect(
      (await suite.db.execute(sql`select count(*) as n from payment_resolutions`)).rows,
    ).toEqual([{ n: 2 }]);
  });

  it.each(["process", "poll", "connection_error", "successful_reader_cancel"] as const)(
    "keeps %s uncertainty with its processor reference",
    async (failure) => {
      const client = new FakeStripe();
      if (failure === "process")
        vi.spyOn(client, "processPaymentIntent").mockRejectedValue(new Error("lost answer"));
      if (failure === "poll") client.throwOnPollNext();
      if (failure === "connection_error")
        vi.spyOn(client, "readerOutcome").mockResolvedValue({
          status: "failed",
          failureCode: "connection_error",
        });
      if (failure === "successful_reader_cancel") client.stallNext();
      const result = await provider(client).collect(await params());
      expect(result.state).toBe("attempting");
      expect(result.settledAt).toBeNull();
      expect(result.failureReason).toBeUndefined();
      expect((await row(result.paymentRef))?.externalRef).toMatch(/^pi_/);
    },
  );

  it.each([
    { status: "succeeded", received: 1210, expected: "captured", forwarded: 1, declined: 0 },
    { status: "succeeded", received: 1209, expected: "attempting", forwarded: 0, declined: 0 },
    { status: "canceled", received: 0, expected: "failed", forwarded: 0, declined: 1 },
    { status: "future_status", received: 0, expected: "attempting", forwarded: 0, declined: 0 },
  ])("sweeps $status / $received without guessing a different outcome", async (test) => {
    const client = new FakeStripe();
    const p = await params();
    const paymentRef = randomUUID();
    client.setIntent("pi_resolve", {
      status: test.status,
      amount: 1210,
      amountReceived: test.received,
    });
    await withTransaction(suite.db, (tx) =>
      insertAttempting(tx, { ...p, provider: "stripe", paymentRef, externalRef: "pi_resolve" }),
    );
    expect(await provider(client).resolvePending(now)).toEqual({
      nextDueAt: test.expected === "attempting" ? new Date(now.getTime() + 60_000) : null,
      forwarded: test.forwarded,
      declined: test.declined,
      incidentsRaised: 0,
    });
    expect((await row(paymentRef))?.state).toBe(test.expected);
    const { rows } = await suite.db.execute(
      sql`select person_id, outcome from payment_resolutions`,
    );
    expect(rows).toEqual(
      test.expected === "attempting" ? [] : [{ person_id: null, outcome: test.expected }],
    );
  });

  it("keeps an unreachable result unknown and captures a cancellation race on the next pass", async () => {
    const client = new FakeStripe();
    const p = await params();
    const paymentRef = randomUUID();
    client.setIntent("pi_racing", { status: "requires_payment_method", amount: 1210 });
    await withTransaction(suite.db, (tx) =>
      insertAttempting(tx, { ...p, provider: "stripe", paymentRef, externalRef: "pi_racing" }),
    );
    client.unreachableNext();
    expect(await provider(client).resolvePending(now)).toEqual({
      nextDueAt: new Date(now.getTime() + 60_000),
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
    expect((await row(paymentRef))?.state).toBe("attempting");
    client.cancelRacesNext();
    expect(await provider(client).resolvePending(now)).toEqual({
      nextDueAt: null,
      forwarded: 1,
      declined: 0,
      incidentsRaised: 0,
    });
    expect((await row(paymentRef))?.state).toBe("captured");
    expect(client.cancelledIntents).toEqual([]);
  });

  it("rolls back the local resolution and generation together when its audit is refused", async () => {
    const client = new FakeStripe();
    const p = await params();
    const paymentRef = randomUUID();
    client.setIntent("pi_audit_refused", { status: "requires_payment_method", amount: 1210 });
    await withTransaction(suite.db, (tx) =>
      insertAttempting(tx, {
        ...p,
        provider: "stripe",
        paymentRef,
        externalRef: "pi_audit_refused",
      }),
    );
    await suite.db.execute(
      sql`create trigger a764_refuse_resolution before insert on payment_resolutions begin select raise(abort, 'audit refused'); end`,
    );
    try {
      await expect(provider(client).resolvePending(now)).rejects.toThrow("audit refused");
      expect((await row(paymentRef))?.state).toBe("attempting");
      expect((await row(paymentRef))?.externalRef).toBe("pi_audit_refused");
      expect(
        await withTransaction(suite.db, (tx) =>
          countProviderCancelledResolutions(tx, {
            provider: "stripe",
            workingOrderId: p.workingOrderId,
          }),
        ),
      ).toBe(0);
    } finally {
      await suite.db.execute(sql`drop trigger a764_refuse_resolution`);
    }
    expect((await provider(client).resolvePending(now)).declined).toBe(1);
    expect((await provider(client).collect(p)).state).toBe("captured");
    expect(client.lastCreateIntent?.idempotencyKey).toBe(`wo_${p.workingOrderId}_r1`);
  });

  it("keeps a timed-out attempt unknown when the reader refuses cancellation", async () => {
    const client = new FakeStripe();
    client.stallNext();
    vi.spyOn(client, "cancelReaderAction").mockRejectedValue(new Error("reader unreachable"));

    const result = await provider(client).collect(await params());
    const stored = await row(result.paymentRef);

    expect(result.state).toBe("attempting");
    expect(stored?.state).toBe("attempting");
    expect(stored?.externalRef).toMatch(/^pi_/);
  });

  it("automatically records a capture that arrives after the reader stopped answering", async () => {
    const client = new FakeStripe();
    const create = vi.spyOn(client, "createPaymentIntent");
    client.stallNext();
    vi.spyOn(client, "cancelReaderAction").mockRejectedValue(new Error("reader unreachable"));
    const terminal = provider(client);
    const result = await terminal.collect(await params());
    const intent = await create.mock.results[0]!.value;
    client.setIntent(intent.id, {
      status: "succeeded",
      amount: 1210,
      amountReceived: 1210,
    });

    const sweep = await terminal.resolvePending(now);

    expect((await row(result.paymentRef))?.state).toBe("captured");
    expect(sweep).toEqual({ nextDueAt: null, forwarded: 1, declined: 0, incidentsRaised: 0 });
  });

  it("automatically clears an abandoned PaymentIntent only after Stripe confirms cancellation", async () => {
    const client = new FakeStripe();
    const p = await params();
    const paymentRef = randomUUID();
    client.setIntent("pi_abandoned_unknown", {
      status: "requires_payment_method",
      amount: 1210,
    });
    await withTransaction(suite.db, (tx) =>
      insertAttempting(tx, {
        ...p,
        provider: "stripe",
        paymentRef,
        externalRef: "pi_abandoned_unknown",
      }),
    );

    const sweep = await provider(client).resolvePending(now);

    expect(client.cancelledIntents).toEqual(["pi_abandoned_unknown"]);
    expect((await row(paymentRef))?.state).toBe("failed");
    expect(sweep).toEqual({ nextDueAt: null, forwarded: 0, declined: 1, incidentsRaised: 0 });
    const cancelled = await withTransaction(suite.db, (tx) =>
      countProviderCancelledResolutions(tx, {
        provider: "stripe",
        workingOrderId: p.workingOrderId,
      }),
    );
    expect(cancelled).toBe(1);
    expect((await provider(client).collect(p)).state).toBe("captured");
    expect(client.lastCreateIntent?.idempotencyKey).toBe(`wo_${p.workingOrderId}_r1`);
  });

  it("leaves a live collection alone when another provider instance sweeps the venue", async () => {
    const client = new FakeStripe();
    const create = vi.spyOn(client, "createPaymentIntent");
    client.stallNext();
    const cancel = vi.spyOn(client, "cancelPaymentIntent");
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const process = client.processPaymentIntent.bind(client);
    vi.spyOn(client, "processPaymentIntent").mockImplementation(async (reader, intent) => {
      signalEntered();
      await released;
      await process(reader, intent);
    });
    const collecting = provider(client).collect(await params());
    try {
      await entered;
      const sweep = await provider(client).resolvePending(now);
      expect(sweep).toEqual({
        nextDueAt: new Date(now.getTime() + 60_000),
        forwarded: 0,
        declined: 0,
        incidentsRaised: 0,
      });
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      release();
    }
    const result = await collecting;
    expect(result.state).toBe("attempting");
    const intent = await create.mock.results[0]!.value;
    client.setIntent(intent.id, { status: "succeeded", amount: 1210, amountReceived: 1210 });
    expect((await provider(client).resolvePending(now)).forwarded).toBe(1);
    expect((await row(result.paymentRef))?.state).toBe("captured");
  });
});
