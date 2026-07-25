import type { StripeReportClient, StripeSessionRef, StripeSettlement } from "../report-client.js";

/** A deterministic in-memory `StripeReportClient` — the hermetic double for the reconcile adapter.
 * NOT barrel-exported (a production import cannot reach it), like `FakeStripe`/`FakeStripeDevice`/
 * `FakeStripeHosted`. It records every window it is asked for, so a test can assert the session pass
 * is widened backwards by the settlement lag — a silent regression there would leave hosted payments
 * unmatched and reading as `unsettled` for ever. */
export class FakeStripeReport implements StripeReportClient {
  readonly settlementWindows: { from: Date; to: Date }[] = [];
  readonly sessionWindows: { from: Date; to: Date }[] = [];
  private readonly settlements: StripeSettlement[];
  private readonly sessions: StripeSessionRef[];

  constructor(config: { settlements?: StripeSettlement[]; sessions?: StripeSessionRef[] } = {}) {
    this.settlements = config.settlements ?? [];
    this.sessions = config.sessions ?? [];
  }

  listSettlements(window: { from: Date; to: Date }): Promise<StripeSettlement[]> {
    this.settlementWindows.push(window);
    return Promise.resolve(this.settlements);
  }

  listCheckoutSessions(window: { from: Date; to: Date }): Promise<StripeSessionRef[]> {
    this.sessionWindows.push(window);
    return Promise.resolve(this.sessions);
  }

  paymentIntentForSession(sessionId: string): Promise<string | null> {
    const found = this.sessions.find((s) => s.sessionId === sessionId);
    return Promise.resolve(found?.paymentIntentId ?? null);
  }
}
