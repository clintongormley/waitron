import type { StripeReportClient, StripeSessionRef, StripeSettlement } from "../report-client.js";

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
