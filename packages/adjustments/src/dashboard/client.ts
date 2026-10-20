import type { DashboardRequest, LiveData, QueryController } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

// Local copies of the routes' JSON shapes: importing the package barrel would pull `@waitron/db` and
// Node builtins into the browser bundle.

export type AdjustmentAction = "cancel" | "comp" | "discount_percent" | "discount_amount";
export type PersonRole = "staff" | "supervisor" | "manager" | "admin";
export type ReasonKind = "void" | "comp";

/** Every field an owner edits. `maxAmount` is euros as a decimal string; a `null` limit is no limit.
 * A Void reason's `actions` is `["cancel"]`, with empty lists and no limits. */
export interface AdjustmentReasonInput {
  name: string;
  names: Record<string, string>;
  kind: ReasonKind;
  actions: AdjustmentAction[];
  maxPercentBp: number | null;
  maxAmount: string | null;
  applyRoles: PersonRole[];
  approverRoles: PersonRole[];
  noteRequired: boolean;
}

/** `maxBillComp` is the money every comp on one bill may take off together; null is no limit. */
export interface AdjustmentSettings {
  maxBillComp: string | null;
  billApproverRoles: PersonRole[];
}

export interface AdjustmentReason extends AdjustmentReasonInput {
  id: string;
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
  /** The stage group the report's totals count this row under. */
  stageGroup: AdjustmentStageGroup;
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

/** One page of the drill-down, newest first. */
export interface AdjustmentEntryPage {
  entries: AdjustmentEntry[];
  /** Passed back as `after` for the following page; null on the last page. */
  next: string | null;
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
      "/management-api/adjustments/reasons",
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

  deleteReason(reasonId: string): Promise<void> {
    return this.request(`/management-api/adjustments/reasons/${reasonId}`, "DELETE");
  }

  /** Keeps `apply` fed with what deleting the reason would do; resolves after the first read. */
  watchReasonDeleteImpact(
    queries: QueryController,
    reasonId: string,
    apply: (impact: DeleteImpact) => void,
  ): Promise<void> {
    return queries.watch(
      "delete-impact",
      {
        key: `adjustments:reason-delete-impact:${reasonId}`,
        dependencies: QUERY_DEPENDENCIES["reason-delete-impact"].map((type) => ({ type })),
        read: () =>
          this.request<DeleteImpact>(
            `/management-api/adjustments/reasons/${reasonId}/delete-impact`,
            "GET",
            undefined,
            { passive: true },
          ),
      },
      apply,
    );
  }

  /** `ids` is every reason, once each, in the new order. */
  reorderReasons(ids: readonly string[]): Promise<void> {
    return this.request("/management-api/adjustments/reason-order", "PUT", { ids });
  }

  getSettings(): Promise<AdjustmentSettings> {
    return this.request<AdjustmentSettings>(
      "/management-api/adjustments/settings",
      "GET",
      undefined,
      { passive: this.passive },
    );
  }

  saveSettings(settings: AdjustmentSettings): Promise<AdjustmentSettings> {
    return this.request("/management-api/adjustments/settings", "PUT", settings);
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

  /** Without a `limit`, the route chooses the page size. */
  listEntries(
    from: string,
    to: string,
    of: EntriesOf,
    page: { after?: string; limit?: number } = {},
  ): Promise<AdjustmentEntryPage> {
    const query = new URLSearchParams({ from, to });
    if (of === "guests") query.set("guests", "true");
    else if (of !== "everyone") query.set("personId", of.personId);
    if (page.after !== undefined) query.set("after", page.after);
    if (page.limit !== undefined) query.set("limit", String(page.limit));
    return this.request<AdjustmentEntryPage>(
      `/management-api/adjustments/report/entries?${query}`,
      "GET",
      undefined,
      { passive: this.passive },
    );
  }
}
