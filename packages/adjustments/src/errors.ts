import "@waitron/shared";
import type { PersonRoleValue } from "@waitron/identity";

declare module "@waitron/shared" {
  interface ErrorParams {
    "adjustment_reason.not_found": { reasonId: string };
    "adjustment_reason.name_taken": { name: string };
    /** `field` names the input the policy refuses, or `ids` for a reorder list. */
    "adjustment_reason.invalid": { field: string };
    // The refusals `evaluateAdjustment` returns as a verdict's `code`.
    "adjustment.action_not_allowed": Record<string, never>;
    "adjustment.over_limit": Record<string, never>;
    "adjustment.note_required": Record<string, never>;
    "adjustment.reason_inactive": Record<string, never>;
    /** A discount larger than the line or bill it is taken off; amounts are decimal strings. */
    "adjustment.exceeds_amount": { requested: string; available: string };
    /** The requester is below the reason's `apply_role`, or the bill's discount limit asks for a
     * manager, and no approver at or above `approverRole` was given. */
    "adjustment.approval_required": { approverRole: PersonRoleValue };
    /** A give-away or a discount that would take nothing off: a give-away or a percentage discount
     * of a line, or of a whole bill, that is already free, or a discount that rounds to nothing at
     * the prices it can set. A cancel is never refused this way. */
    "adjustment.no_reduction": { workingOrderId: string };
    /** Part of a line sold in a unit with decimal places, which a give-away or a discount takes
     * only whole; a cancel can take part of it. */
    "adjustment.weighed_partial": { workingOrderId: string; lineNo: number };
    /** Not a positive quantity in the line's unit, no larger than the line, or part of an extras
     * row, whose quantity follows its dish; or, for a give-away or a discount, part of a dish with
     * an extra that is not a whole count for each dish, of which no part can be taken, only the
     * whole. `lineNo` is the line asked about. */
    "adjustment.quantity_invalid": { workingOrderId: string; lineNo: number; quantity: string };
  }
}
