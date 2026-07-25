import type { Decimal } from "@waitron/shared";
import type { DeviceCollectOutcome, StripeDeviceClient } from "../device-client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

/** The next collect scenario, distinct from the resolved outcome — because the OFFLINE scenario's
 * outcome depends on `offlineAllowed`, so a test cannot script the outcome directly and still exercise
 * the provider's gate. */
type DeviceScenario = "online" | "offline" | "declined";

/** Deterministic in-memory `StripeDeviceClient` — the hermetic double for the on-device Stripe adapter.
 * NOT barrel-exported (a production import cannot reach it), like `FakeStripe`/`FakePaymentProvider`.
 * Controls: `nextCollect(scenario)` shapes the next `collectOnDevice` (default `online`, one-shot);
 * `queueResult({settled, declined})` scripts the next `syncOfflineQueue` (one-shot); `refundFailsNext`
 * fails the next refund. The OFFLINE scenario faithfully models a real device — it stores-and-forwards
 * (→ `accepted_offline`) only when `offlineAllowed`, otherwise refuses (→ `network_unavailable`) — so
 * the provider's neutral gate is load-bearing: a test only reaches `accepted_offline` by configuring
 * policy so the gate accepts. */
export class FakeStripeDevice implements StripeDeviceClient {
  private scenario: DeviceScenario = "online";
  private nextQueue: { settled: string[]; declined: string[] } = { settled: [], declined: [] };
  private nextRefundFails = false;

  /** The last `collectOnDevice` params, so a test can assert what was stamped onto the device's
   * PaymentIntent — the `missingLocal` attribution hint. Mirrors `FakeStripeHosted.lastCreate`. */
  lastCollect: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    offlineAllowed: boolean;
    metadata: { working_order_id: string; payment_ref: string };
  } | null = null;

  nextCollect(scenario: DeviceScenario): void {
    this.scenario = scenario;
  }
  queueResult(result: { settled: string[]; declined: string[] }): void {
    this.nextQueue = result;
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
    offlineAllowed: boolean;
    metadata: { working_order_id: string; payment_ref: string };
  }): Promise<{ outcome: DeviceCollectOutcome; externalRef?: string }> {
    this.lastCollect = params;
    const scenario = this.scenario;
    this.scenario = "online";
    if (scenario === "declined") return Promise.resolve({ outcome: "declined" });
    if (scenario === "offline") {
      // A real device stores-and-forwards only when offline was permitted; otherwise it refuses and
      // nothing is stored. This makes the provider's gate (which computes offlineAllowed) load-bearing.
      return Promise.resolve(
        params.offlineAllowed
          ? { outcome: "accepted_offline", externalRef: nextId("pi") }
          : { outcome: "network_unavailable" },
      );
    }
    return Promise.resolve({ outcome: "captured", externalRef: nextId("pi") });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- refs unused: the fake returns the scripted result verbatim
  syncOfflineQueue(_refs: string[]): Promise<{ settled: string[]; declined: string[] }> {
    const result = this.nextQueue;
    this.nextQueue = { settled: [], declined: [] };
    return Promise.resolve(result);
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
