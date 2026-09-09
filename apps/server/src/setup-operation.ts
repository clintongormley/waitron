import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { writeFileAtomic } from "./fs-atomic.js";
import "./errors.js";

export type SetupOperationKind = "provision" | "adopt" | "restore" | "import";
export type SetupOperationPhase = "started" | "venue_committed" | "publishing" | "complete";

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
      !["started", "venue_committed", "publishing", "complete"].includes(value.phase ?? "") ||
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
export function createSetupOperationStore(stateDir: string): SetupOperationStore {
  const statePath = join(stateDir, "setup-operation.json");
  const lockPath = join(stateDir, "setup-operation.lock");

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

  const acquire = async (): Promise<string> => {
    await mkdir(stateDir, { recursive: true });
    const token = randomUUID();
    const writeLock = async (): Promise<void> => {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
      } finally {
        await handle.close();
      }
    };
    try {
      await writeLock();
      return token;
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    let owner: { pid?: unknown };
    try {
      owner = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown };
    } catch {
      throw new AppError("setup.already_provisioning", {});
    }
    if (!Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0) {
      throw new AppError("setup.already_provisioning", {});
    }
    try {
      process.kill(Number(owner.pid), 0);
      throw new AppError("setup.already_provisioning", {});
    } catch (error) {
      if (!hasCode(error, "ESRCH")) throw error;
    }
    await unlink(lockPath).catch((error: unknown) => {
      if (!hasCode(error, "ENOENT")) throw error;
    });
    try {
      await writeLock();
      return token;
    } catch (error) {
      if (hasCode(error, "EEXIST")) throw new AppError("setup.already_provisioning", {});
      throw error;
    }
  };

  const release = async (token: string): Promise<void> => {
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8")) as { token?: unknown };
      if (lock.token === token) await unlink(lockPath);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  };

  return {
    read,
    async run(kind, requestHash, fn) {
      const token = await acquire();
      try {
        const existing = await read();
        if (existing !== null && (existing.kind !== kind || existing.requestHash !== requestHash)) {
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
        if (existing === null) await writeFileAtomic(statePath, JSON.stringify(state), 0o600);
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
          await writeFileAtomic(statePath, JSON.stringify(state), 0o600);
          Object.assign(operation, state);
        };
        const operation: ActiveSetupOperation = {
          ...state,
          advance: (phase, data) => persist(phase, data),
          complete: (data) => persist("complete", data),
        };
        return await fn(operation);
      } finally {
        await release(token);
      }
    },
  };
}
