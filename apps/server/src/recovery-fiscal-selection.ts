import { getCountryPack } from "@waitron/country-packs";
import { enabledModules, parseModuleConfig, type WaitronModule } from "@waitron/module";
import { expectedSchemaVersion } from "@waitron/migrations";
import type { ArchiveEntry } from "./backup-archive.js";
import type { BackupManifest } from "./backup-manifest.js";

export interface RecoveryFiscalSelection {
  readonly country: string;
  readonly fiscalTerritory: string;
  readonly timeZone: string;
  readonly module: string;
}

export function recoveryFiscalSelection(
  venue: Omit<RecoveryFiscalSelection, "module">,
  manifest: BackupManifest,
  entries: readonly ArchiveEntry[],
  modules: readonly WaitronModule[],
  migrationsRoot: string | null,
  recordedVersions: Readonly<Record<string, number>>,
): RecoveryFiscalSelection | undefined {
  const pack = getCountryPack(venue.country);
  const jurisdiction = pack?.fiscalJurisdictions.find(
    (entry) => entry.id === venue.fiscalTerritory,
  );
  if (
    pack?.countryCode !== venue.country ||
    jurisdiction?.supported !== true ||
    jurisdiction.modules === undefined
  )
    return;
  try {
    new Intl.DateTimeFormat("en", { timeZone: venue.timeZone });
  } catch {
    return;
  }
  const saved = entries.find((entry) => entry.name === "secrets/modules.json");
  if (saved === undefined) return;
  let selected: WaitronModule[];
  try {
    selected = enabledModules(
      modules,
      parseModuleConfig(JSON.parse(Buffer.from(saved.bytes).toString("utf8")), modules),
    ).filter((module) => module.fiscal !== undefined);
  } catch {
    return;
  }
  const owner = selected[0];
  if (
    selected.length !== 1 ||
    owner?.fiscal?.id !== jurisdiction.modules.filing ||
    !Number.isSafeInteger(manifest.modules[owner.name]) ||
    manifest.modules[owner.name]! < 0 ||
    recordedVersions[owner.name] !== manifest.modules[owner.name]
  )
    return;
  if (
    manifest.modules[owner.name] === 0 &&
    expectedSchemaVersion(owner.migrations, migrationsRoot) !== 0
  )
    return;
  return { ...venue, module: owner.name };
}
