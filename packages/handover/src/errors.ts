import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /** `field` is the dotted path of the first field refused, or `binding` for the whole value. */
    "handover.request_invalid": { field: string };
    /** `from` is null when the box has no record of the operation yet. */
    "handover.step_out_of_order": { from: string | null; to: string };
    /** `field` is the dotted path of the first part of the indicator refused. */
    "handover.indicator_mismatch": { field: string };
  }
}
