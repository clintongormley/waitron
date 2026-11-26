import type { ExtraSelection, OptionSelection } from "@waitron/shared";

/**
 * One basket line the till sends to the order writer. The server prices it from the menu.
 *
 * `options` answers the dish's options lists, one entry per list, naming the list and the chosen
 * label; `extras` answers its extras lists, one entry per list, naming the PRODUCTS picked off it and
 * how many of each this dish takes. Each key is ABSENT on a line that answered nothing of that kind —
 * never `[]`. Every ACTIVE options list a dish attaches must be answered, or the line is refused
 * `options.label_required` (`validateOptionSelections`, `packages/menu/src/option-contract.ts`).
 *
 * `note` is a NON-FISCAL free-text kitchen instruction, stored on the working-order line only, never on
 * the sale. It is ABSENT for a plain line — a whitespace-only note is omitted.
 */
export interface SaleLine {
  /** Stable server line identity on a retrieved order; omitted for a newly selected line. */
  workingOrderLineId?: string;
  menuItemId?: string;
  variantId?: string;
  /** The menu version an unsaved line was priced against. The server refuses the request
   * `menu.version_changed` when it is not the live one; absent means the live one. */
  menuVersionId?: string;
  setMenuId?: string;
  setMenuReservedLineId?: string;
  setMenuReservedPlace?: number;
  quantity: string;
  extras?: ExtraSelection[];
  options?: OptionSelection[];
  note?: string;
  makeAt?: string | null;
}
/** What every group command sends: its submission id, and the party's revision as last read. */
export interface GroupCommand {
  submissionId: string;
  expectedPartyRevision: number;
}

export interface BillEditState {
  billId: string;
  editorId: string | null;
  editorName: string | null;
  editorVersion: number;
  draftId: string | null;
  draftRevision: number | null;
}

export type BillEditExpected = Pick<
  BillEditState,
  "billId" | "editorVersion" | "draftId" | "draftRevision"
>;

export type KitchenNoteScope = { workingOrderId: string } | { partyId: string };

export interface KitchenNoteSnapshot {
  scope: KitchenNoteScope;
  note: string | null;
  revision: number;
  ownerRevision: number;
}
