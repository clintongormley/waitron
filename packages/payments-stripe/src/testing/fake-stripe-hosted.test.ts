import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { FakeStripeHosted } from "./fake-stripe-hosted.js";

describe("FakeStripeHosted", () => {
  it("createCheckoutSession returns a cs_ id and a url", async () => {
    const client = new FakeStripeHosted();
    const s = await client.createCheckoutSession({
      amount: decimal("12.10"),
      currency: "eur",
      idempotencyKey: "pay-1",
      metadata: { working_order_id: "wo-1", payment_ref: "pay-1" },
    });
    expect(s.id).toMatch(/^cs_/);
    expect(s.url).toContain(s.id);
    expect(client.lastCreate?.metadata).toEqual({
      working_order_id: "wo-1",
      payment_ref: "pay-1",
    });
  });

  it("constructWebhookEvent parses an event() payload", () => {
    const payload = FakeStripeHosted.event({
      sessionId: "cs_abc",
      type: "checkout.session.completed",
      amountTotalMinor: 1210,
      createdAt: new Date("2026-03-01T13:05:00Z"),
    });
    const e = new FakeStripeHosted().constructWebhookEvent(payload, "good");
    expect(e.type).toBe("checkout.session.completed");
    expect(e.sessionId).toBe("cs_abc");
    expect(e.amountTotalMinor).toBe(1210);
    expect(e.createdAt.toISOString()).toBe("2026-03-01T13:05:00.000Z");
  });

  it("constructWebhookEvent throws on a bad signature when failSignatureNext is armed", () => {
    const client = new FakeStripeHosted();
    client.failSignatureNext();
    const payload = FakeStripeHosted.event({
      sessionId: "cs_x",
      type: "checkout.session.completed",
    });
    expect(() => client.constructWebhookEvent(payload, "bad")).toThrow(/signature/i);
  });
});
