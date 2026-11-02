import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /** `field` is the dotted path of the first field refused, or `binding` for the whole value. */
    "handover.request_invalid": { field: string };
  }
}
