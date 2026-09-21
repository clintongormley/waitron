import type { ChangeSource } from "@waitron/shared";

/**
 * The resource names the events endpoint accepts as subscription interests: every type a module's
 * `ChangeSource` declares, plus the extras added below. None of those extras is a table, so no row
 * change can ever produce one and the screens naming them refresh on their query's own timer
 * instead (`refreshMs` in `apps/dashboard/src/api/live-queries.ts`). They are listed here anyway
 * because one unrecognised name makes `parseInterests` (`live-api.ts`) refuse the WHOLE stream.
 */
export function liveResourceTypes(sources: readonly ChangeSource[]): string[] {
  return [
    ...new Set([
      ...sources.flatMap((source) => [
        source.type,
        ...(source.related ?? []).map((related) => related.type),
      ]),
      "pairing",
      "printer_discovery",
      "email_inbox",
      "backup_status",
      "google_config",
    ]),
  ];
}
