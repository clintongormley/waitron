import type { ReconcilePeriod, SettlementReportSource, SettlementRecord } from "../reconcile.js";

/**
 * A deterministic `SettlementReportSource` returning a fixed set of settlements and recording every
 * window it was asked for, so a test can assert that the sweep widened its fetch by the settlement
 * lag.
 * NOT re-exported from the package barrel — a production import cannot reach a test double.
 */
export class FakeSettlementReport implements SettlementReportSource {
  readonly windows: ReconcilePeriod[] = [];

  constructor(private readonly records: SettlementRecord[]) {}

  async fetch(window: ReconcilePeriod): Promise<SettlementRecord[]> {
    this.windows.push(window);
    return this.records;
  }
}
