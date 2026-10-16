import { randomUUID } from "node:crypto";
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
      expect(sweep).toEqual({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      release();
    }
    expect((await collecting).state).toBe("captured");
  });
});
