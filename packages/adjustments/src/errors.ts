import "@waitron/shared";

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
  }
}
