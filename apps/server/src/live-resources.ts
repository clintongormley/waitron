import type { ChangeSource } from "@waitron/shared";

/** Process-local queries use timers even when no database notification can be emitted. */
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
