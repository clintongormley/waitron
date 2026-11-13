import { FIRST_SETUP_FILE } from "@waitron/store";
import { AppError } from "@waitron/shared";
import { join, resolve } from "node:path";
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
  return inTurn(turns, resolve(stateDir), async () => {
    const current = await readSetupFlowRecord(stateDir);
    if (current === null && section !== "attempt") invalid();
    const next = { ...current, version: 1, [section]: change(current?.[section]) };
    if (!object(next.attempt)) invalid();
    await writeDurableHostJson(join(stateDir, FIRST_SETUP_FILE), next, limit);
  });
}
