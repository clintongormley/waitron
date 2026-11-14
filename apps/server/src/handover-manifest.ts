import type { Database } from "@waitron/db";
import { stat } from "node:fs/promises";
import type { KeyRing } from "@waitron/credentials";
import {
  isSha256Hex,
  NODE_LOCAL_MANIFEST,
  MODULE_PREPARED_ITEM,
  refuseRequest,
  sha256Hex,
  type NodeLocalItem,
  type NodeLocalManifestRow,
  type RetainedRevision,
} from "@waitron/handover";
import { canonicalize } from "@waitron/membership";
import { imageMigrationHashes, manifestSets } from "@waitron/migrations";
import { readModulePreparationRevisions } from "@waitron/provisioning";
import { AppError, isAppError, type ErrorCode } from "@waitron/shared";
import { BACKUP_ENV_FILE, SECRETS_ENV_FILE } from "@waitron/store";
import { backupSettingsDigestOf, readBackupSettings } from "./backup-env-writer.js";
import { readModuleConfig } from "./module-config.js";
import "./errors.js";

/**
 * `secrets.env` carries its key versions, not a digest: the receiving box must hold every version
 * the sender lists, which a digest of the file cannot answer. The two settings files are digested
 * as values, so two boxes that hold the same settings in another order or spacing read alike.
 */
export async function buildNodeLocalManifest(
  stateDir: string,
  ring: KeyRing,
  db: Database,
): Promise<NodeLocalItem[]> {
  const items: NodeLocalItem[] = [];
  for (const row of NODE_LOCAL_MANIFEST) items.push(await manifestItem(row, stateDir, ring, db));
  return items;
}

async function manifestItem(
  row: NodeLocalManifestRow,
  stateDir: string,
  ring: KeyRing,
  db: Database,
): Promise<NodeLocalItem> {
  if (row.item === "settings:modules") return { ...row, sha256: await moduleSettingsDigest(db) };
  if (row.where !== "state") return { ...row };
  switch (row.item) {
    case BACKUP_ENV_FILE:
      return { ...row, sha256: backupSettingsDigestOf(await readBackupSettings(stateDir)) };
    case SECRETS_ENV_FILE:
      return { ...row, ringVersions: ringVersions(ring) };
    case MODULE_PREPARED_ITEM: {
      // The file holds parsed JSON, so each value is one a signed body can carry.
      const revisions = await readModulePreparationRevisions({ stateDir });
      return { ...row, revisions: revisions as readonly RetainedRevision[] };
    }
    default:
      return { ...row };
  }
}

/** What a handover offer says of the box making it, for the box receiving it to compare. */
export interface OfferSettings {
  readonly backupSettings: string | null;
  readonly moduleSettings: string | null;
  readonly ringVersions: readonly number[];
}

/**
 * The manifest's own facts, built whole so that a file the final copy's indicator could not read
 * is found now. `unreadable` is the refusal for that, naming the file and never what it holds.
 */
export async function readOfferSettings(
  stateDir: string,
  ring: KeyRing,
  unreadable: "handover.settings_unreadable" | "handover.destination_settings_unreadable",
  db: Database,
): Promise<OfferSettings> {
  // A manifest read from a missing folder would say every file is absent, the same as a box with
  // no settings. `file` must name a state row: the first stands for all of them.
  const folder = await stat(stateDir).catch(() => null);
  if (folder === null || !folder.isDirectory()) {
    throw new AppError(
      unreadable,
      { file: BACKUP_ENV_FILE },
      { reason: "the state folder cannot be read" },
    );
  }
  let backupSettings: string | null = null;
  let moduleSettings: string | null = null;
  for (const row of NODE_LOCAL_MANIFEST) {
    let item: NodeLocalItem;
    try {
      item = await manifestItem(row, stateDir, ring, db);
    } catch (error) {
      const cause = isAppError(error) ? error.code : (error as NodeJS.ErrnoException).code;
      throw new AppError(
        unreadable,
        { file: row.item },
        { reason: `${row.item}: ${cause ?? "unknown"}` },
      );
    }
    if (row.where === "state" && row.item === BACKUP_ENV_FILE) {
      backupSettings = item.sha256 ?? null;
    } else if (row.item === "settings:modules") {
      moduleSettings = item.sha256 ?? null;
    }
  }
  return { backupSettings, moduleSettings, ringVersions: ringVersions(ring) };
}

/** Also accepts the modules settings item: the refusal's `file` field names either source. */
export function isManifestStateFile(file: unknown): boolean {
  return NODE_LOCAL_MANIFEST.some(
    (row) => (row.where === "state" || row.item === "settings:modules") && row.item === file,
  );
}

/**
 * The migrations this image ships, every set whether switched on or not, for two boxes to find they
 * run different releases. Module versions cannot say so: every module's is `0.0.0`.
 */
export function imageMigrationsDigest(root: string | null): string {
  const hashes = Object.fromEntries(
    manifestSets().map((set) => [set.name, imageMigrationHashes(set, root)]),
  );
  return sha256Hex(canonicalize(hashes));
}

function digestAt(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (!isSha256Hex(value)) refuseRequest(field);
  return value;
}

/** A received offer's settings; a wrong shape refuses `handover.request_invalid`. */
export function parseOfferSettings(raw: unknown): OfferSettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) refuseRequest("settings");
  const fields = raw as Record<string, unknown>;
  if (Object.keys(fields).sort().join() !== "backupSettings,moduleSettings,ringVersions") {
    refuseRequest("settings");
  }
  const { ringVersions: versions } = fields;
  if (
    !Array.isArray(versions) ||
    versions.length === 0 ||
    !versions.every((version) => Number.isSafeInteger(version) && (version as number) >= 1)
  ) {
    refuseRequest("settings.ringVersions");
  }
  return {
    backupSettings: digestAt(fields.backupSettings, "settings.backupSettings"),
    moduleSettings: digestAt(fields.moduleSettings, "settings.moduleSettings"),
    ringVersions: versions as number[],
  };
}

/** The refusal for the first way `offered` differs from this box's `own`; a box may hold more. */
export function offerSettingsDifference(
  offered: OfferSettings,
  own: OfferSettings,
): Extract<
  ErrorCode,
  "handover.backup_settings_differ" | "handover.modules_differ" | "handover.key_ring_mismatch"
> | null {
  if (offered.backupSettings !== own.backupSettings) return "handover.backup_settings_differ";
  if (offered.moduleSettings !== own.moduleSettings) return "handover.modules_differ";
  if (offered.ringVersions.some((version) => !own.ringVersions.includes(version))) {
    return "handover.key_ring_mismatch";
  }
  return null;
}

function ringVersions(ring: KeyRing): number[] {
  const versions = [ring.current.version];
  if (ring.previous !== undefined) versions.push(ring.previous.version);
  return versions.sort((a, b) => a - b);
}

/**
 * Only the modules switched off: a module is on unless named `false` (`isEnabled`), and setup names
 * the filing module `true` (`fiscal-slot.ts`), so a `true` entry changes no box's module set.
 */
async function moduleSettingsDigest(db: Database): Promise<string | null> {
  const { overrides } = await readModuleConfig(db);
  const off = [...overrides].filter(([, enabled]) => !enabled);
  return off.length === 0 ? null : sha256Hex(canonicalize(Object.fromEntries(off)));
}
