import type { TenantId } from "@waitron/shared";
import type { ReconcilePeriod, SettlementReportSource, SettlementRecord } from "../reconcile.js";

/**
 * A deterministic `SettlementReportSource` returning a fixed set of settlements and recording every
 * window AND every tenant it was asked for, so a test can assert both that the sweep widened its
 * fetch by the settlement lag and that it scoped the fetch to the tenant it is sweeping (a real
 * source over a shared processor account has to filter on it — see `SettlementReportSource`).
 * NOT re-exported from the package barrel — a production import cannot reach a test double.
 */
export class FakeSettlementReport implements SettlementReportSource {
  readonly windows: ReconcilePeriod[] = [];
  readonly tenants: TenantId[] = [];

  constructor(private readonly records: SettlementRecord[]) {}

  async fetch(tenantId: TenantId, window: ReconcilePeriod): Promise<SettlementRecord[]> {
    this.tenants.push(tenantId);
    this.windows.push(window);
    return this.records;
  }
}
