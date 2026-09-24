import type { ReconcilePeriod, SettlementReportSource, SettlementRecord } from "../reconcile.js";

/** Returns a fixed set of settlements and records every window it was asked for. */
export class FakeSettlementReport implements SettlementReportSource {
  readonly windows: ReconcilePeriod[] = [];

  constructor(private readonly records: SettlementRecord[]) {}

  async fetch(window: ReconcilePeriod): Promise<SettlementRecord[]> {
    this.windows.push(window);
    return this.records;
  }
}
