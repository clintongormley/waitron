import type { AllergyPatch } from "@waitron/module";
import type { OptionSelection, ExtraSelection, Dining } from "@waitron/shared";
import type { TillCourse } from "./device-session-api.js";
import type { GroupLine, GroupRelease, OrderGroup, TabLine, PrintProblem } from "./kitchen-api.js";
import type { GroupCommand, BillEditExpected, BillEditState, SaleLine } from "./order-types.js";
import {
  type TillSaleResult,
  type BillParty,
  type BillBalance,
  PaymentsApi,
} from "./payments-api.js";
import type { TillRequest, ReadOptions } from "./till-request.js";

/** Record (`requested: true`) or take back the party's bill request. */
export interface BillRequestCommand extends GroupCommand {
  requested: boolean;
}
/** A group submission: the groups in the order they go in the party's sequence, or one held group
 * added to the existing held group `joinGroupId`. */
export interface GroupSubmission extends GroupCommand {
  allergy?: AllergyPatch;
  expectedEdit: BillEditExpected;
  groups: {
    lines: GroupLine[];
    release: GroupRelease;
    joinGroupId?: string;
    afterGroupId?: string;
  }[];
  joinGroupId?: string;
}
/** The answer to a group submission: the tab the lines landed on, the party's revision after it, and
 * the groups created or joined. */
export interface SubmittedGroups {
  tabId: string;
  revision: number;
  groups: OrderGroup[];
}

export interface FreshDraftLine {
  setMenuId?: string;
  setMenuReservedLineId?: string | null;
  setMenuReservedPlace?: number | null;
  sourceLineId: null;
  source: null;
  id: string;
  menuItemId: string;
  variantId: string | null;
  /** The published menu version the line was priced against; null means the live one. */
  menuVersionId: string | null;
  options: OptionSelection[];
  extras: ExtraSelection[];
  note: string | null;
  /** A decimal string of up to three places. */
  quantity: string;
  /** The waiter's course override; null means the product's default course. */
  courseId: string | null;
  /** Read-only course identity derived from the stored selection. */
  course?: TillCourse;
  /** The waiter's chosen making station; null follows the venue route. */
  makeAt?: string | null;
  /** Never merged with another line, either way; Split quantity's rows carry it. */
  noMerge: boolean;
  slot: number;
  joinGroupId: string | null;
  afterGroupId: string | null;
  unavailable: boolean;
}

export type DraftLine = FreshDraftLine;

export type FreshDraftLineInput = Omit<
  FreshDraftLine,
  "id" | "unavailable" | "course" | "source" | "sourceLineId"
> & { id?: string; sourceLineId?: null };

export type DraftLineInput = FreshDraftLineInput;

export interface DeadEndAnswer {
  sends: boolean;
  deadEnds: {
    key: string;
    name: string;
    quantity: string;
    stationId: string;
    stationName: string;
    why: "closed" | "switched_off";
  }[];
  stations: { id: string; name: string; open: boolean }[];
  revision?: number;
}
/** A bill's saved unsent dishes at the revision last read or saved. */
export interface Draft {
  id: string;
  partyId: string;
  billId: string;
  ownerId: string;
  ownerName: string;
  revision: number;
  lines: DraftLine[];
  /** The owner before the draft was last taken over; null when it never was. `name` is "" for a
   * person the server has no name for. */
  takenOverFrom: { personId: string; name: string } | null;
}
/** A save of the signed-in person's draft: `draftId` null and `revision` 0 start a new one. */
export interface DraftSave {
  billId: string;
  draftId: string | null;
  revision: number;
  expectedEdit: BillEditExpected;
  lines: DraftLineInput[];
}

export interface BillDraftSnapshot {
  invoice?: TillSaleResult;
  draft: Draft | null;
  edit: BillEditState;
}

export interface PartyDraftSnapshot {
  drafts: Draft[];
  billEdits: BillEditState[];
}

export interface DraftTakeover {
  revision: number;
  expectedEdit: BillEditExpected;
  submissionId: string;
}

export interface DraftDiscard {
  submissionId: string;
  revision: number;
  expectedRevision: number;
  expectedEdit: BillEditExpected;
  reasonId?: string;
  note?: string | null;
  approver?: { personId: string; pin: string };
}

export interface DiscardedDraft {
  invoice?: TillSaleResult;
  draftId: string;
  billId: string;
  revision: number;
  adjustmentIds: string[];
  party: BillParty;
}
/** The ended menus a send confirms the kitchen agreed to, with a manager's PIN where one is needed. */
export interface LateSend {
  menuIds: string[];
  override?: { personId: string; pin: string };
}
/** A submission of lines of the draft at `draftRevision`, each group naming that revision's line
 * ids, in the order the groups go in the party's sequence. */
export interface DraftSubmission extends GroupCommand {
  allergy?: AllergyPatch;
  expectedEdit: BillEditExpected;
  draftRevision: number;
  groups: {
    lineIds: string[];
    release: GroupRelease;
    joinGroupId?: string;
    afterGroupId?: string;
  }[];
  joinGroupId?: string;
  billId?: string;
  lateSend?: LateSend;
  /** The way the screen showed the bill. */
  dining: Dining;
}
/** The groups placed, and the draft as it is left: null once every line was sent. */
export type SubmittedDraft = SubmittedGroups & BillDraftSnapshot;
/** One bill’s saved unsent dishes; `lineCount` counts rows, not units. */
export interface UnsentDraft {
  billId: string;
  /** Null when the bill was stored with no number, a fault in Waitron. */
  billNumber: number | null;
  ownerId: string;
  ownerName: string;
  lineCount: number;
  /** The draft's `updated_at` as the box stored it. */
  savedAt: string;
}
/** `GET /api/parties/:id/split-sources`: the party's own open and presented bills, in number order,
 * and the party's revision read in the same transaction. */
export interface SplitSources {
  partyRevision: number;
  bills: { billId: string; lines: TabLine[]; balance: BillBalance }[];
}

export class DraftsApi extends PaymentsApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    super(request);
    this.#request = request;
  }
  /** A party's order groups in sequence, with its revision and its kitchen tickets that have not
   * printed → `GET /api/parties/:partyId/groups`. */
  listGroups(
    partyId: string,
    options: ReadOptions = {},
  ): Promise<{ revision: number; groups: OrderGroup[]; printProblems: PrintProblem[] }> {
    return this.#request(`/api/parties/${partyId}/groups`, "GET", undefined, options.signal);
  }
  submitGroups(
    partyId: string,
    submission: GroupSubmission,
    options: ReadOptions = {},
  ): Promise<SubmittedGroups> {
    return this.#request(`/api/parties/${partyId}/groups`, "POST", submission, options.signal);
  }
  /** Saved outboxes and every bill's editing state, read together. */
  listDrafts(partyId: string, options: ReadOptions = {}): Promise<PartyDraftSnapshot> {
    return this.#request(`/api/parties/${partyId}/drafts`, "GET", undefined, options.signal);
  }
  /** Every open and presented bill of this party, with its dishes and balance. */
  getSplitSources(partyId: string, options: ReadOptions = {}): Promise<SplitSources> {
    return this.#request(`/api/parties/${partyId}/split-sources`, "GET", undefined, options.signal);
  }
  /** Replace this bill's outbox at its observed editing state. */
  saveDraft(
    partyId: string,
    save: DraftSave,
    options: ReadOptions = {},
  ): Promise<BillDraftSnapshot> {
    return this.#request(`/api/parties/${partyId}/drafts`, "PUT", save, options.signal);
  }
  discardDraft(
    partyId: string,
    draftId: string,
    command: DraftDiscard,
    options: ReadOptions = {},
  ): Promise<DiscardedDraft> {
    return this.#request(
      `/api/parties/${partyId}/drafts/${draftId}/discard`,
      "POST",
      command,
      options.signal,
    );
  }
  askDraftDeadEnds(
    partyId: string,
    draftId: string,
    lineIds: string[],
    options: ReadOptions = {},
  ): Promise<DeadEndAnswer> {
    return this.#request(
      "/api/dead-ends/draft",
      "POST",
      { partyId, draftId, lineIds },
      options.signal,
    );
  }
  askSaleDeadEnds(
    request:
      | ({ step: "pay" | "place"; lines: SaleLine[]; dining?: Dining } & {
          zoneId?: string;
          workingOrderId?: string;
        })
      | (SaleLine & { workingOrderLineId?: string })[],
    workingOrderId?: string,
  ): Promise<DeadEndAnswer> {
    return this.#request(
      "/api/dead-ends/sale",
      "POST",
      Array.isArray(request) ? { step: "edit", lines: request, workingOrderId } : request,
    );
  }
  setMakeAt(
    workingOrderId: string,
    revision: number,
    lines: Record<string, string>,
    expectedEdit: BillEditExpected | null,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/working-orders/${workingOrderId}/make-at`, "PUT", {
      revision,
      lines,
      expectedEdit,
    });
  }
  splitDraft(
    partyId: string,
    draftId: string,
    command: GroupCommand & { expectedEdit: BillEditExpected; lineIds: string[] },
    options: ReadOptions = {},
  ): Promise<{
    billId: string;
    revision: number;
    source: BillDraftSnapshot;
    destination: BillDraftSnapshot;
  }> {
    return this.#request(
      `/api/parties/${partyId}/drafts/${draftId}/split`,
      "POST",
      command,
      options.signal,
    );
  }
  /** Transfer the shown bill's saved outbox in place, with replay under the same submission id. */
  takeOverDraft(
    partyId: string,
    draftId: string,
    command: DraftTakeover,
    options: ReadOptions = {},
  ): Promise<BillDraftSnapshot> {
    return this.#request(
      `/api/parties/${partyId}/drafts/${draftId}/take-over`,
      "POST",
      command,
      options.signal,
    );
  }
  /**
   * Send lines of the signed-in person's draft as groups →
   * `POST /api/parties/:partyId/drafts/:draftId/submit`. A repeat with the same submission id answers
   * as the first. Rejects, among others, the `draft.*` refusals, `party.out_of_date`,
   * `party.not_open`, `submission.id_reused` and pricing refusals such as `menu.version_changed`.
   */
  submitDraft(
    partyId: string,
    draftId: string,
    submission: DraftSubmission,
    options: ReadOptions = {},
  ): Promise<SubmittedDraft> {
    return this.#request(
      `/api/parties/${partyId}/drafts/${draftId}/submit`,
      "POST",
      submission,
      options.signal,
    );
  }
}
