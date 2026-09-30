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
    /** Part of the quantity of a dish that has extras, which a give-away or a discount takes only
     * whole; a cancel can take part of it. */
    "adjustment.partial_with_extras": { workingOrderId: string; lineNo: number };
    /** An extras row named on its own; an adjustment names the dish it belongs to. */
    "adjustment.line_not_adjustable": { workingOrderId: string; lineNo: number };
    /** Not a positive quantity in the line's unit, no larger than the line, or part of a weighed
     * line, which is comped or discounted only whole. */
    "adjustment.quantity_invalid": { workingOrderId: string; lineNo: number; quantity: string };
  }
}
