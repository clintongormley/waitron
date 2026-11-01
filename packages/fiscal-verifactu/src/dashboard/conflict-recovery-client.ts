import type { DashboardRequest } from "@waitron/dashboard-kit";
import {
  parseConflictResult,
  type ConflictRequest,
  type ConflictResult,
} from "../conflict-recovery-contract.js";

export class ConflictRecoveryClient {
  constructor(private readonly request: DashboardRequest) {}
  async send(body: ConflictRequest, signal: AbortSignal): Promise<ConflictResult> {
    const result = parseConflictResult(
      await this.request("/api/module-recovery/fiscal-verifactu/conflict", "POST", body, {
        signal,
        timeLimitMs: 35_000,
        refusals: "envelope",
        sessionErrors: "caller",
        activity: "none",
      }),
    );
    if (result === null) throw { code: "connection.failed" };
    return result;
  }
}
