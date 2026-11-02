// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as
// a real module to augment rather than declaring a fresh ambient one.
import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /** No `convenio_config` row: the venue has not configured its working-time rules. */
    "convenio.not_found": Record<string, never>;
  }
}
