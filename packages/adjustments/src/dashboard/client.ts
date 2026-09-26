import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";

// Local copies of the routes' JSON shapes: importing the package barrel would pull `@waitron/db` and
// Node builtins into the browser bundle.

export type AdjustmentAction = "cancel" | "comp" | "discount_percent" | "discount_amount";
export type PersonRole = "staff" | "supervisor" | "manager" | "admin";

/** Every field an owner edits. `maxAmount` is euros as a decimal string; a `null` limit is no limit. */
export interface AdjustmentReasonInput {
  name: string;
  names: Record<string, string>;
  actions: AdjustmentAction[];
  maxPercentBp: number | null;
  maxAmount: string | null;
  applyRole: PersonRole;
  approverRole: PersonRole;
  noteRequired: boolean;
}

export interface AdjustmentReason extends AdjustmentReasonInput {
  id: string;
  active: boolean;
  position: number;
}

export class AdjustmentsApi {
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
    private readonly passive = false,
  ) {}

  get background(): AdjustmentsApi {
    return new AdjustmentsApi(this.request, this.liveData, true);
  }

  async listReasons(): Promise<AdjustmentReason[]> {
    const body = await this.request<{ reasons: AdjustmentReason[] }>(
      "/management-api/adjustments/reasons?includeInactive=true",
      "GET",
      undefined,
      { passive: this.passive },
    );
    return body.reasons;
  }

  createReason(input: AdjustmentReasonInput): Promise<AdjustmentReason> {
    return this.request("/management-api/adjustments/reasons", "POST", input);
  }

  updateReason(reasonId: string, input: AdjustmentReasonInput): Promise<AdjustmentReason> {
    return this.request(`/management-api/adjustments/reasons/${reasonId}`, "PUT", input);
  }

  deactivateReason(reasonId: string): Promise<void> {
    return this.request(`/management-api/adjustments/reasons/${reasonId}`, "DELETE");
  }

  /** `ids` is every active reason, once each, in the new order. */
  reorderReasons(ids: readonly string[]): Promise<void> {
    return this.request("/management-api/adjustments/reason-order", "PUT", { ids });
  }
}
