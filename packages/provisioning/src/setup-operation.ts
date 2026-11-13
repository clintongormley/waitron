import { SETUP_OPERATION_FILE } from "@waitron/store";
import type { FirstSetupCoordinator, FirstSetupHold } from "./first-setup-state.js";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError } from "@waitron/shared";
import { failedAtFolderSync, mkdirDurable, writeFileDurable } from "./fs-atomic.js";
import "./errors.js";

export type SetupOperationKind = "provision" | "adopt" | "restore" | "import";
export type SetupOperationPhase =
  | "started"
  | "venue_committed"
  | "content_seeded"
  | "identity_established"
  | "membership_seeded"
  | "secret_sealed"
  | "publishing"
  | "complete";

export interface SetupOperationState {
  version: 1;
  id: string;
  kind: SetupOperationKind;
  requestHash: string;
  phase: SetupOperationPhase;
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface ActiveSetupOperation extends SetupOperationState {
  advance(
    phase: Exclude<SetupOperationPhase, "complete">,
    data?: Record<string, unknown>,
  ): Promise<void>;
  complete(data?: Record<string, unknown>): Promise<void>;
}

export interface SetupOperationStore {
  read(): Promise<SetupOperationState | null>;
  run<T>(
    kind: SetupOperationKind,
    requestHash: string,
    fn: (operation: ActiveSetupOperation) => Promise<T>,
    hold?: FirstSetupHold,
  ): Promise<T>;
}

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

function parseState(raw: string): SetupOperationState | null {
  try {
    const value = JSON.parse(raw) as Partial<SetupOperationState>;
    if (
      value.version !== 1 ||
      typeof value.id !== "string" ||
      !["provision", "adopt", "restore", "import"].includes(value.kind ?? "") ||
      typeof value.requestHash !== "string" ||
      ![
        "started",
        "venue_committed",
        "content_seeded",
        "identity_established",
        "membership_seeded",
        "secret_sealed",
        "publishing",
        "complete",
      ].includes(value.phase ?? "") ||
      typeof value.data !== "object" ||
      value.data === null ||
      Array.isArray(value.data) ||
      typeof value.updatedAt !== "string"
    )
      return null;
    return value as SetupOperationState;
  } catch {
    return null;
  }
}

/** Persist and serialize first-boot work so a supervised restart can resume a known request. */
export function createSetupOperationStore(
  stateDir: string,
  options: { coordinator?: FirstSetupCoordinator; guard?: () => Promise<void> } = {},
): SetupOperationStore {
  const statePath = join(stateDir, SETUP_OPERATION_FILE);
  let active = false;

  const read = async (): Promise<SetupOperationState | null> => {
    try {
      const parsed = parseState(await readFile(statePath, "utf8"));
      if (parsed === null) throw new AppError("setup.operation_conflict", {});
      return parsed;
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  };

  return {
    read,
    run(kind, requestHash, fn, hold) {
      const execute = async () => {
        await options.guard?.();
        if (active) throw new AppError("setup.already_provisioning", {});
        active = true;
        try {
          await mkdirDurable(dirname(statePath), 0o700);
          const existing = await read();
          if (
            existing !== null &&
            (existing.kind !== kind || existing.requestHash !== requestHash)
          ) {
            throw new AppError("setup.operation_conflict", {});
          }
          let state: SetupOperationState = existing ?? {
            version: 1,
            id: randomUUID(),
            kind,
            requestHash,
            phase: "started",
            data: {},
            updatedAt: new Date().toISOString(),
          };
          const persist = async (
            phase: SetupOperationPhase,
            data?: Record<string, unknown>,
          ): Promise<void> => {
            state = {
              ...state,
              phase,
              data: data ?? state.data,
              updatedAt: new Date().toISOString(),
            };
            try {
              await writeFileDurable(statePath, JSON.stringify(state), 0o600);
            } catch (error) {
              if (failedAtFolderSync(error)) Object.assign(operation, state);
              throw error;
            }
            Object.assign(operation, state);
          };
          const operation: ActiveSetupOperation = {
            ...state,
            advance: (phase, data) => persist(phase, data),
            complete: (data) => persist("complete", data),
          };
          try {
            if (existing === null) await writeFileDurable(statePath, JSON.stringify(state), 0o600);
            return await fn(operation);
          } catch (error) {
            if (operation.phase === "started") {
              await unlink(statePath).catch((unlinkError: unknown) => {
                if (!hasCode(unlinkError, "ENOENT")) throw unlinkError;
              });
            }
            throw error;
          }
        } finally {
          active = false;
        }
      };
      return options.coordinator === undefined
        ? execute()
        : hold === undefined
          ? options.coordinator.run(execute)
          : options.coordinator.held(hold, execute);
    },
  };
}
