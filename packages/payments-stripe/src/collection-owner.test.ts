import { captureAlerts } from "@waitron/payments/test/capture-alerts.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { freshNif, seedPaymentPolicy, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeStripe } from "./testing/fake-stripe.js";
import { FakeStripeDevice } from "./testing/fake-stripe-device.js";
import { FakeStripeHosted } from "./testing/fake-stripe-hosted.js";
import { StripeTerminalProvider } from "./provider.js";
import { StripeOnDeviceProvider } from "./device-provider.js";
import { StripeHostedProvider } from "./hosted-provider.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

async function params() {
  const s = await seedWorkingOrder(suite.db, freshNif());
  return {
    s,
    collect: {
      origin: deviceOrigin(s.deviceId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      nodeId: s.nodeId,
      amount: decimal("10.00"),
    },
  };
}

async function storedNode(paymentRef: string): Promise<string | null | undefined> {
  const rows = await suite.db.execute<{ node_id: string | null }>(
    sql`select node_id from payments where provider = 'stripe' and payment_ref = ${paymentRef}`,
  );
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0]?.node_id;
}

describe("a Stripe payment carries the node id of the box that started it", () => {
  it("StripeTerminalProvider.collect", async () => {
    const { s, collect } = await params();
    const provider = new StripeTerminalProvider({
      captureAlerts,
      client: new FakeStripe(),
      db: suite.db,
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    const result = await provider.collect({ ...collect, readerRef: "reader_1" });
    expect(result.state).toBe("captured");
    expect(await storedNode(result.paymentRef)).toBe(s.nodeId);
  });

  it("StripeOnDeviceProvider.collect, captured", async () => {
    const { s, collect } = await params();
    const result = await new StripeOnDeviceProvider({
      client: new FakeStripeDevice(),
      db: suite.db,
    }).collect(collect);
    expect(result.state).toBe("captured");
    expect(await storedNode(result.paymentRef)).toBe(s.nodeId);
  });

  it("StripeOnDeviceProvider.collect, declined", async () => {
    const { s, collect } = await params();
    const client = new FakeStripeDevice();
    client.nextCollect("declined");
    const result = await new StripeOnDeviceProvider({ client, db: suite.db }).collect(collect);
    expect(result.state).toBe("failed");
    expect(await storedNode(result.paymentRef)).toBe(s.nodeId);
  });

  it("StripeOnDeviceProvider.collect, accepted offline", async () => {
    const { s, collect } = await params();
    await seedPaymentPolicy(suite.db, "accept_offline", "50.00");
    const client = new FakeStripeDevice();
    client.nextCollect("offline");
    const result = await new StripeOnDeviceProvider({ client, db: suite.db }).collect({
      ...collect,
      allowOffline: true,
    });
    expect(result.state).toBe("accepted_offline");
    expect(await storedNode(result.paymentRef)).toBe(s.nodeId);
  });

  it("StripeHostedProvider.initiate", async () => {
    const { s, collect } = await params();
    const paymentRef = randomUUID();
    await new StripeHostedProvider({ client: new FakeStripeHosted(), db: suite.db }).initiate({
      ...collect,
      paymentRef,
    });
    expect(await storedNode(paymentRef)).toBe(s.nodeId);
  });
});
