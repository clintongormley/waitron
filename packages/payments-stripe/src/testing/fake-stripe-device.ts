import type { Decimal } from "@waitron/shared";
import type { DeviceCollectOutcome, StripeDeviceClient } from "../device-client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

type DeviceScenario = "online" | "offline" | "declined";

export class FakeStripeDevice implements StripeDeviceClient {
  private scenario: DeviceScenario = "online";
  private nextRefundFails = false;

  lastCollect: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    metadata: { working_order_id: string; payment_ref: string };
  } | null = null;

  nextCollect(scenario: DeviceScenario): void {
    this.scenario = scenario;
  }
  refundFailsNext(): void {
    this.nextRefundFails = true;
  }

  createConnectionToken(): Promise<{ secret: string }> {
    return Promise.resolve({ secret: nextId("pst") });
  }

  collectOnDevice(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    metadata: { working_order_id: string; payment_ref: string };
  }): Promise<{ outcome: DeviceCollectOutcome; externalRef?: string }> {
    this.lastCollect = params;
    const scenario = this.scenario;
    this.scenario = "online";
    if (scenario === "declined") return Promise.resolve({ outcome: "declined" });
    if (scenario === "offline") {
      return Promise.resolve({ outcome: "network_unavailable" });
    }
    return Promise.resolve({ outcome: "captured", externalRef: nextId("pi") });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  refund(_params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }> {
    const fails = this.nextRefundFails;
    this.nextRefundFails = false;
    return Promise.resolve({ id: nextId("re"), status: fails ? "failed" : "succeeded" });
  }
}
