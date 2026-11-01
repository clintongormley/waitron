import type { Transaction } from "@waitron/db";
import { readIssueZone, type IssueScope } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";

export type TradingAdmissionView =
  { state: "ready" } | { state: "unchecked" | "missing" | "invalid" | "restart_required" };
export class TradingAdmission {
  #state: TradingAdmissionView["state"] = "unchecked";
  snapshot(): TradingAdmissionView {
    return { state: this.#state };
  }
  require(): void {
    if (this.#state !== "ready")
      throw new AppError("venue.time_zone_not_ready", { reason: this.#state });
  }
  repairOnly(reason: "missing" | "invalid"): void {
    this.#state = reason;
  }
  requireRestart(): void {
    this.#state = "restart_required";
  }
  admit(): void {
    this.#state = "ready";
  }
}
export async function requireEconomicWrite(
  tx: Transaction,
  scope: IssueScope,
  admission: TradingAdmission,
): Promise<void> {
  admission.require();
  await readIssueZone(tx, scope);
}
