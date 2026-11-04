import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AppError, isAppError } from "@waitron/shared";
import "./errors.js";
import { type FirstSetupCoordinator, type FirstSetupHold } from "./first-setup-state.js";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import type { OperationBinding } from "@waitron/module";

interface Revision {
  binding: OperationBinding;
  value: unknown;
}
interface File {
  version: 1;
  revisions: Revision[];
}
/** A host that gates writes on the owner's grant gates waits too: both checks, or neither. */
type GrantChecks =
  | { authorizeReplacement(): Promise<void>; authorizeWait(): Promise<void> }
  | { authorizeReplacement?: never; authorizeWait?: never };
type Options = GrantChecks & {
  stateDir: string;
  venueDir: string;
  coordinator: FirstSetupCoordinator;
  authorize(binding: OperationBinding): Promise<void>;
  withVenueExclusion<T>(run: () => Promise<T>): Promise<T>;
};
const FILE_NAME = "module-preparation-state.json";
const LIMIT = 1024 * 1024;
function invalid(): never {
  throw new AppError("setup.attempt_invalid", {});
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validBinding(value: unknown): value is OperationBinding {
  return (
    record(value) &&
    Object.keys(value).length === 5 &&
    ["module", "action", "eventId", "sourceId", "targetNodeId"].every(
      (key) => typeof value[key] === "string" && (value[key] as string).trim().length > 0,
    )
  );
}
function parse(value: unknown): File {
  if (value === null) return { version: 1, revisions: [] };
  if (
    !record(value) ||
    Object.keys(value).length !== 2 ||
    value.version !== 1 ||
    !Array.isArray(value.revisions)
  )
    return invalid();
  for (const revision of value.revisions) if (!wellFormedRevision(revision)) return invalid();
  return value as unknown as File;
}
function wellFormedRevision(revision: unknown): revision is Revision {
  return (
    record(revision) &&
    Object.keys(revision).length === 2 &&
    validBinding(revision.binding) &&
    Object.hasOwn(revision, "value")
  );
}
function snapshot(value: unknown): unknown {
  try {
    const json: unknown = JSON.parse(JSON.stringify(value));
    if (!isDeepStrictEqual(json, value)) return invalid();
    return json;
  } catch {
    return invalid();
  }
}
async function readStateFile(stateDir: string): Promise<File> {
  try {
    return parse(await readDurableHostJson(join(stateDir, FILE_NAME), LIMIT));
  } catch (error) {
    if (!isAppError(error)) throw error;
    throw new AppError("setup.attempt_invalid", {}, { reason: `${FILE_NAME} cannot be read` });
  }
}
export async function readModulePreparationHistory(
  options: { stateDir: string; venueDir: string },
  module: string,
): Promise<readonly unknown[]> {
  const file = await readStateFile(options.stateDir);
  return file.revisions
    .filter((row) => row.binding.module === module)
    .map((row) => structuredClone(row.value));
}
/** Every module's revisions, in the order they were written; none when the file is absent. */
export async function readModulePreparationRevisions(options: {
  stateDir: string;
}): Promise<readonly { binding: OperationBinding; value: unknown }[]> {
  const file = await readStateFile(options.stateDir);
  return file.revisions;
}
function bindingKey({ module, action, eventId, sourceId, targetNodeId }: OperationBinding): string {
  return JSON.stringify([module, action, eventId, sourceId, targetNodeId]);
}
/** `incoming`, then `own`, each revision once: an equal value under an equal binding is one. */
function mergedRevisions(own: readonly Revision[], incoming: readonly Revision[]): Revision[] {
  const seen = new Map<string, Revision[]>();
  const merged: Revision[] = [];
  for (const revision of [...incoming, ...own]) {
    const key = bindingKey(revision.binding);
    const same = seen.get(key) ?? [];
    if (same.some((row) => isDeepStrictEqual(row.value, revision.value))) continue;
    same.push(revision);
    seen.set(key, same);
    merged.push(revision);
  }
  return merged;
}
/**
 * Whether this box's file could take `incoming`: a file over its limit makes every later module
 * operation refuse `setup.attempt_invalid`.
 */
export async function modulePreparationMergeFits(
  options: { stateDir: string },
  incoming: readonly { binding: OperationBinding; value: unknown }[],
): Promise<boolean> {
  const own = await readStateFile(options.stateDir);
  const merged: File = { version: 1, revisions: mergedRevisions(own.revisions, incoming) };
  return Buffer.byteLength(JSON.stringify(merged)) <= LIMIT;
}
export function createModulePreparationState(options: Options) {
  return {
    async withState<T>(
      bindingInput: OperationBinding,
      run: (state: {
        readonly value: unknown;
        readonly history: readonly unknown[];
        replace(value: unknown, purpose?: "wait" | "intent"): Promise<void>;
      }) => Promise<T>,
      hold?: FirstSetupHold,
    ): Promise<T> {
      if (!validBinding(bindingInput)) return invalid();
      const binding = { ...bindingInput };
      const body = () =>
        options.withVenueExclusion(async () => {
          await options.authorize({ ...binding });
          const path = join(options.stateDir, FILE_NAME);
          const file = await readStateFile(options.stateDir);
          let value: unknown =
            [...file.revisions].reverse().find((row) => row.binding.module === binding.module)
              ?.value ?? null;
          let active = true;
          let writes = Promise.resolve();
          const check = () => {
            if (!active) throw new AppError("setup.attempt_conflict", {});
          };
          try {
            const result = await run({
              get value() {
                check();
                return structuredClone(value);
              },
              get history() {
                check();
                return structuredClone(
                  file.revisions
                    .filter((row) => row.binding.module === binding.module)
                    .map((row) => row.value),
                );
              },
              async replace(next, purpose = "intent") {
                check();
                const supplied = snapshot(next);
                writes = writes.then(async () => {
                  check();
                  await options.authorize({ ...binding });
                  if (purpose === "wait") await options.authorizeWait?.();
                  else await options.authorizeReplacement?.();
                  const candidate: File = {
                    version: 1,
                    revisions: [...file.revisions, { binding: { ...binding }, value: supplied }],
                  };
                  await writeDurableHostJson(path, candidate, LIMIT);
                  await options.authorize({ ...binding });
                  file.revisions = candidate.revisions;
                  value = supplied;
                });
                return writes;
              },
            });
            await writes;
            await options.authorize({ ...binding });
            return result;
          } finally {
            try {
              await writes;
            } finally {
              active = false;
            }
          }
        });
      return hold === undefined
        ? options.coordinator.run(body)
        : options.coordinator.held(hold, body);
    },
  };
}
