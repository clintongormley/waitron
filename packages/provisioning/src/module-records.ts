import { MODULE_RECORDS_DIR } from "@waitron/store";
import { setAsideUnreadableModuleRecord } from "./first-setup-start-again-set-aside.js";
import { AppError, isAppError } from "@waitron/shared";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import "./errors.js";

export interface ModuleRecord {
  version: 1;
  prepared: unknown[];
  retained: Record<string, unknown>;
}
const LIMIT = 1024 * 1024;
const invalid = () => new AppError("setup.attempt_invalid", {});
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function recordPath(stateDir: string, module: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(module)) throw invalid();
  return join(stateDir, MODULE_RECORDS_DIR, `${module}.json`);
}
export async function readModuleRecord(stateDir: string, module: string): Promise<ModuleRecord> {
  const path = recordPath(stateDir, module);
  const value = await readDurableHostJson(path, LIMIT);
  if (value === null) return { version: 1, prepared: [], retained: {} };
  if (
    !record(value) ||
    Object.keys(value).length !== 3 ||
    value.version !== 1 ||
    !Array.isArray(value.prepared) ||
    !record(value.retained)
  )
    throw invalid();
  return value as unknown as ModuleRecord;
}
export async function moduleRecordNames(stateDir: string): Promise<string[]> {
  const directory = join(stateDir, MODULE_RECORDS_DIR);
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
    const names = await readdir(directory);
    return names
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => {
        const module = name.slice(0, -5);
        recordPath(stateDir, module);
        return module;
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export async function updateModulePrepared(
  stateDir: string,
  module: string,
  change: (prepared: readonly unknown[]) => unknown[],
): Promise<void> {
  const current = await readModuleRecord(stateDir, module);
  await writeDurableHostJson(
    recordPath(stateDir, module),
    {
      ...current,
      prepared: change(current.prepared),
    },
    LIMIT,
  );
}

export async function replaceModuleRetained(
  stateDir: string,
  module: string,
  retained: Record<string, unknown>,
): Promise<void> {
  const current = await readModuleRecord(stateDir, module);
  await writeDurableHostJson(recordPath(stateDir, module), { ...current, retained }, LIMIT);
}
export async function clearModulePrepared(stateDir: string): Promise<void> {
  for (const module of await moduleRecordNames(stateDir)) {
    const path = recordPath(stateDir, module);
    let retained: Record<string, unknown>;
    try {
      const value = await readDurableHostJson(path, LIMIT);
      if (!record(value) || value.version !== 1 || !record(value.retained)) throw invalid();
      retained = value.retained;
    } catch (error) {
      if (!isAppError(error)) throw error;
      await setAsideUnreadableModuleRecord(stateDir, path);
      continue;
    }
    await writeDurableHostJson(path, { version: 1, prepared: [], retained }, LIMIT);
  }
}
export async function moduleRecordBytes(
  stateDir: string,
  module: string,
  retained: Record<string, unknown>,
): Promise<Uint8Array> {
  const own = await readModuleRecord(stateDir, module);
  const bytes = Buffer.from(
    JSON.stringify({
      ...own,
      retained: { ...own.retained, ...retained },
    }),
  );
  if (bytes.byteLength > LIMIT)
    throw new AppError(
      "setup.attempt_invalid",
      {},
      {
        reason: `${MODULE_RECORDS_DIR}/${module}.json exceeds its size limit`,
      },
    );
  return bytes;
}
