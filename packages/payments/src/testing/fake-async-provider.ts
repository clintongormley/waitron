import { decimal } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type {
  AsyncPaymentProvider,
  InboundSettlement,
  InitiateParams,
  InitiateResult,
} from "../provider.js";
import { insertInitiated } from "../store.js";

let counter = 0;
const nextHostedId = (): string => `fake-hosted-${String(++counter).padStart(8, "0")}`;

/** A genuine DB-backed test double for the async / hosted mode, not a stub. `initiate` persists a
 * real `initiated` `payments` row through its own short transaction (no caller tx — the interface
 * forbids it). `verifyAndParse` trusts its payload (there is no signature to check in the fake): the
 * payload is a JSON-encoded settlement built by the static `event` helper. NOT re-exported from the
 * package barrel — a production import cannot reach it. */
export class FakeAsyncProvider implements AsyncPaymentProvider {
  readonly provider = "fake";

  constructor(private readonly db: Database) {}

  async initiate(params: InitiateParams): Promise<InitiateResult> {
    const externalRef = nextHostedId();
    await this.db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: params.tenantId,
        workingOrderId: params.workingOrderId,
        provider: this.provider,
        paymentRef: params.paymentRef,
        externalRef,
        amount: params.amount,
      }),
    );
    return { ref: params.paymentRef, externalRef, url: `https://fake.pay/${externalRef}` };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `signature` is part of the interface; the fake has nothing to verify it against
  verifyAndParse(payload: string, _signature: string): InboundSettlement | null {
    const raw = JSON.parse(payload) as {
      provider: string;
      externalRef: string;
      outcome: "settled" | "expired";
      amount: string;
      settledAt: string;
    };
    if (raw.provider !== this.provider) return null;
    return {
      provider: raw.provider,
      externalRef: raw.externalRef,
      outcome: raw.outcome,
      amount: decimal(raw.amount),
      settledAt: new Date(raw.settledAt),
    };
  }

  /** Build the raw inbound payload for a settlement of this provider, the shape `verifyAndParse`
   * decodes — the async analogue of `FakePaymentProvider`'s configurable outcomes. */
  static event(e: {
    externalRef: string;
    outcome: "settled" | "expired";
    amount: string;
    settledAt: Date;
  }): string {
    return JSON.stringify({
      provider: "fake",
      externalRef: e.externalRef,
      outcome: e.outcome,
      amount: e.amount,
      settledAt: e.settledAt.toISOString(),
    });
  }
}
