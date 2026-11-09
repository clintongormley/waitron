import { settingsChangeType, type ChangeSource } from "@waitron/shared";

/** Suffixed sources admit only declared document keys; the bare type would watch every module. */
export function liveResourceTypes(
  sources: readonly ChangeSource[],
  settingsModules: readonly string[] = [],
): string[] {
  return [
    ...new Set([
      ...sources.flatMap((source) => [
        ...(source.typeSuffixColumn === undefined ? [source.type] : []),
        ...(source.related ?? []).map((related) => related.type),
      ]),
      ...settingsModules.map(settingsChangeType),
      "pairing",
      "printer_discovery",
      "email_inbox",
      "backup_status",
      "google_config",
    ]),
  ];
}
