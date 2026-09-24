// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as
// a real module to augment rather than declaring a fresh ambient one.
import "@waitron/shared";

/**
 * packages/workforce-es's contribution to the shared error registry, by declaration merging. Codes
 * are never renamed once shipped.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /**
     * No `convenio_config` row for this location — not configured. The overtime rule
     * and guardrails a work-time summary needs cannot be resolved without one.
     */
    "convenio.not_found": { locationId: string };
  }
}
