import {
  FIRST_SETUP_FILE,
  FISCAL_READINESS_FILE,
  SETUP_OPERATION_FILE,
  START_AGAIN_GUESSES_FILE,
  SETUP_FLOW_DIR,
  FIRST_FISCAL_DOCUMENTS_DIR,
  CONFIGURATION_IMPORT_FILE,
} from "@waitron/store";
import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import { AppError } from "@waitron/shared";
import { dirname, join } from "node:path";
import { errnoOf } from "./errno.js";
import { canonicalFirstSetupDirectory } from "./first-setup-directories.js";
import { inTurn } from "./attempt-turns.js";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import type { FirstSetupState } from "./first-setup-state.js";
import "./errors.js";

export interface SetupFlowRecord {
  readonly version: 1;
  readonly attempt: FirstSetupState;
  readonly nodeKey?: unknown;
  readonly publicEvidence?: unknown;
  readonly recoveryManifests?: Readonly<Record<string, unknown>>;
}
export type SetupFlowSection = "attempt" | "nodeKey" | "publicEvidence" | "recoveryManifests";
const limit = 1024 * 1024;
const turns = {};
const sectionLimits = {
  attempt: limit,
  nodeKey: 4096,
  publicEvidence: 64 * 1024,
  recoveryManifests: 16 * 1024,
};
const invalid = (): never => {
  throw new AppError("setup.attempt_invalid", {});
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export async function readSetupFlowRecord(stateDir: string): Promise<SetupFlowRecord | null> {
  const value = await readDurableHostJson(join(stateDir, FIRST_SETUP_FILE), limit);
  if (value === null) return null;
  if (
    !object(value) ||
    value.version !== 1 ||
    !object(value.attempt) ||
    Object.keys(value).some(
      (key) =>
        !["version", "attempt", "nodeKey", "publicEvidence", "recoveryManifests"].includes(key),
    ) ||
    (value.recoveryManifests !== undefined && !object(value.recoveryManifests))
  )
    invalid();
  return value as unknown as SetupFlowRecord;
}
export async function updateSetupFlowSection<K extends SetupFlowSection>(
  stateDir: string,
  section: K,
  change: (current: SetupFlowRecord[K] | undefined) => SetupFlowRecord[K],
): Promise<void> {
  const root = await canonicalFirstSetupDirectory(stateDir);
  return inTurn(turns, root, async () => {
    const current = await readSetupFlowRecord(root);
    if (current === null && section !== "attempt") invalid();
    const value = change(current?.[section]);
    try {
      const values =
        section === "recoveryManifests" && object(value) ? Object.values(value) : [value];
      if (
        values.some(
          (entry) =>
            entry !== undefined &&
            Buffer.byteLength(JSON.stringify(entry)) > sectionLimits[section],
        )
      )
        invalid();
    } catch {
      invalid();
    }
    const next = { ...current, version: 1, [section]: value };
    if (!object(next.attempt)) invalid();
    await writeDurableHostJson(join(root, FIRST_SETUP_FILE), next, limit);
  });
}

export async function endFinishedSetup(stateDir: string): Promise<void> {
  const record = await readSetupFlowRecord(stateDir);
  if (record === null || record.attempt.status !== "complete") return;
  const ifPresent = async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await operation();
    } catch (error) {
      if (errnoOf(error) === "ENOENT") return undefined;
      throw error;
    }
  };
  for (const relative of [
    FIRST_SETUP_FILE,
    FISCAL_READINESS_FILE,
    SETUP_OPERATION_FILE,
    START_AGAIN_GUESSES_FILE,
  ])
    await ifPresent(() => unlink(join(stateDir, relative)));
  for (const relative of [FIRST_FISCAL_DOCUMENTS_DIR, dirname(CONFIGURATION_IMPORT_FILE)]) {
    const folder = join(stateDir, relative);
    const info = await ifPresent(() => lstat(folder));
    if (!info?.isDirectory()) continue;
    const entries = await readdir(folder, { withFileTypes: true });
    for (const entry of entries)
      if (entry.isFile()) await ifPresent(() => unlink(join(folder, entry.name)));
    try {
      await rmdir(folder);
    } catch (error) {
      if (!["ENOTEMPTY", "EEXIST"].includes(errnoOf(error) ?? "")) throw error;
    }
  }
  await rmdir(join(stateDir, SETUP_FLOW_DIR));
}
