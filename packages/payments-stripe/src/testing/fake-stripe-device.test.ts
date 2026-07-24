import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { FakeStripeDevice } from "./fake-stripe-device.js";

const params = (offlineAllowed: boolean) => ({
  amount: decimal("10.00"),
  currency: "eur",
  idempotencyKey: "k1",
  offlineAllowed,
});

describe("FakeStripeDevice", () => {
  it("defaults to the online scenario → captured with a pi_ externalRef", async () => {
    const r = await new FakeStripeDevice().collectOnDevice(params(false));
    expect(r.outcome).toBe("captured");
    expect(r.externalRef).toMatch(/^pi_/);
  });

  it("offline scenario yields accepted_offline only when offlineAllowed, else network_unavailable", async () => {
    const f = new FakeStripeDevice();
    f.nextCollect("offline");
    const stored = await f.collectOnDevice(params(true));
    expect(stored.outcome).toBe("accepted_offline");
    expect(stored.externalRef).toMatch(/^pi_/);

    f.nextCollect("offline");
    const refused = await f.collectOnDevice(params(false));
    expect(refused.outcome).toBe("network_unavailable");
    expect(refused.externalRef).toBeUndefined();
  });

  it("declined scenario yields declined; scenario resets to online after one use", async () => {
    const f = new FakeStripeDevice();
    f.nextCollect("declined");
    expect((await f.collectOnDevice(params(true))).outcome).toBe("declined");
    expect((await f.collectOnDevice(params(true))).outcome).toBe("captured");
  });

  it("queueResult scripts the next syncOfflineQueue and resets to empty", async () => {
    const f = new FakeStripeDevice();
    f.queueResult({ settled: ["a"], declined: ["b"] });
    expect(await f.syncOfflineQueue(["a", "b"])).toEqual({ settled: ["a"], declined: ["b"] });
    expect(await f.syncOfflineQueue(["a"])).toEqual({ settled: [], declined: [] });
  });

  it("refundFailsNext fails one refund then succeeds", async () => {
    const f = new FakeStripeDevice();
    f.refundFailsNext();
    expect((await f.refund({ paymentIntentId: "pi_1", idempotencyKey: "r1" })).status).toBe(
      "failed",
    );
    expect((await f.refund({ paymentIntentId: "pi_1", idempotencyKey: "r2" })).status).toBe(
      "succeeded",
    );
  });

  it("createConnectionToken returns a secret", async () => {
    expect((await new FakeStripeDevice().createConnectionToken()).secret).toMatch(/^pst_/);
  });
});
