import type { WaitronModule } from "@waitron/module";
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
        ...(source.quiet === undefined ? [] : [source.quiet.type]),
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

export function liveResourceTypesForModules(
  modules: readonly Pick<WaitronModule, "changes" | "settings">[],
): string[] {
  return liveResourceTypes(
    modules.flatMap((module) => module.changes ?? []),
    modules.flatMap((module) => (module.settings ?? []).map((document) => document.module)),
  );
}
