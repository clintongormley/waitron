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

/** Amounts are decimal strings with two places, as the report routes write them. */
export interface AdjustmentTally {
  count: number;
  reduction: string;
  cancelledNominalValue: string;
}

export type AdjustmentStageGroup = "beforeFiring" | "afterFiring" | "afterServing" | "billDiscount";

export interface ReasonTally extends AdjustmentTally {
  reasonId: string;
  reasonName: string;
}

export interface AdjustmentTotals extends AdjustmentTally {
  byAction: Record<AdjustmentAction, AdjustmentTally>;
  byStage: Record<AdjustmentStageGroup, AdjustmentTally>;
  byReason: ReasonTally[];
}

export interface PersonRef {
  personId: string;
  name: string | null;
}

export interface PersonAdjustments extends AdjustmentTotals, PersonRef {
  sales: string;
  /** One decimal place; null when there are no sales. */
  ratePercent: string | null;
  approvers: (PersonRef & { count: number })[];
  approvalsGiven: number;
}

export interface AdjustmentReport {
  fromBusinessDay: string;
  toBusinessDay: string;
  overall: AdjustmentTotals & { sales: string; ratePercent: string | null };
  people: PersonAdjustments[];
  guests: AdjustmentTotals;
}

export interface AdjustmentEntry {
  id: string;
  createdAt: string;
  action: AdjustmentAction;
  stage: "unsent" | "held" | "fired" | "served" | null;
  reasonId: string;
  reasonName: string;
  note: string | null;
  lineName: string | null;
  /** Three decimal places; null on a discount on the whole bill. */
  quantity: string | null;
  percentBp: number | null;
  beforeAmount: string;
  afterAmount: string;
  reduction: string;
  nominalValue: string;
  requestedBy: PersonRef;
  approvedBy: PersonRef | null;
  creditedTo: PersonRef | null;
  byGuest: boolean;
  workingOrderId: string;
  orderNumber: number;
}

/** Whose adjustments the drill-down lists. */
export type EntriesOf = "everyone" | "guests" | { personId: string };

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

  /** Without a range, the routes answer the venue's current business day. */
  getReport(range?: { from: string; to: string }): Promise<AdjustmentReport> {
    const query = range === undefined ? "" : `?${new URLSearchParams(range)}`;
    return this.request<AdjustmentReport>(
      `/management-api/adjustments/report${query}`,
      "GET",
      undefined,
      { passive: this.passive },
    );
  }

  async listEntries(from: string, to: string, of: EntriesOf): Promise<AdjustmentEntry[]> {
    const query = new URLSearchParams({ from, to });
    if (of === "guests") query.set("guests", "true");
    else if (of !== "everyone") query.set("personId", of.personId);
    const body = await this.request<{ entries: AdjustmentEntry[] }>(
      `/management-api/adjustments/report/entries?${query}`,
      "GET",
      undefined,
      { passive: this.passive },
    );
    return body.entries;
  }
}
