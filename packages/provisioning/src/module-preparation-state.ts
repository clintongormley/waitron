import { MODULE_RECORDS_DIR } from "@waitron/store";
import { isDeepStrictEqual } from "node:util";
import { AppError, isAppError } from "@waitron/shared";
import "./errors.js";
import { type FirstSetupCoordinator, type FirstSetupHold } from "./first-setup-state.js";
import { readModuleRecord, moduleRecordNames, updateModulePrepared } from "./module-records.js";
import { isOperationBinding, type OperationBinding } from "@waitron/module";

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

const LIMIT = 1024 * 1024;
const MERGE_ROOM_FLOOR = 8 * 1024;
function invalid(): never {
  throw new AppError("setup.attempt_invalid", {});
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function wellFormedRevision(revision: unknown): revision is Revision {
  return (
    record(revision) &&
    Object.keys(revision).length === 2 &&
    isOperationBinding(revision.binding) &&
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
async function readPrepared(stateDir: string, module: string): Promise<Revision[]> {
  const name = `${MODULE_RECORDS_DIR}/${module}.json`;
  try {
    const { prepared } = await readModuleRecord(stateDir, module);
    if (prepared.some((row) => !wellFormedRevision(row) || row.binding.module !== module))
      invalid();
    return prepared as Revision[];
  } catch (error) {
    if (!isAppError(error)) throw error;
    throw new AppError("setup.attempt_invalid", {}, { reason: `${name} cannot be read` });
  }
}
async function readStateFile(stateDir: string): Promise<File> {
  const revisions: Revision[] = [];
  for (const module of await moduleRecordNames(stateDir))
    revisions.push(...(await readPrepared(stateDir, module)));
  return { version: 1, revisions };
}
function preparedBytes(revisions: readonly Revision[]): number {
  return Buffer.byteLength(JSON.stringify({ version: 1, prepared: revisions, retained: {} }));
}
async function writePrepared(
  stateDir: string,
  revisions: Revision[],
  module: string,
): Promise<void> {
  if (preparedBytes(revisions) > LIMIT) invalid();
  await updateModulePrepared(stateDir, module, () =>
    revisions.filter((row) => row.binding.module === module),
  );
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
/** Each module's revisions retain their order; modules are listed by filename. */
export async function readModulePreparationRevisions(options: {
  stateDir: string;
}): Promise<readonly { binding: OperationBinding; value: unknown }[]> {
  const file = await readStateFile(options.stateDir);
  return file.revisions;
}
function bindingKey({ module, action, eventId, sourceId, targetNodeId }: OperationBinding): string {
  return JSON.stringify([module, action, eventId, sourceId, targetNodeId]);
}
/**
 * The revisions of `incoming` that `own` lacks, each once, in `incoming`'s order. Revisions come
 * off the wire with their keys sorted, so an equal value under an equal binding is the same one.
 */
function missingRevisions(own: readonly Revision[], incoming: readonly Revision[]): Revision[] {
  const seen = new Map<string, unknown[]>();
  const values = (revision: Revision) => {
    const key = bindingKey(revision.binding);
    const held = seen.get(key) ?? [];
    seen.set(key, held);
    return held;
  };
  for (const revision of own) values(revision).push(revision.value);
  const missing: Revision[] = [];
  for (const revision of incoming) {
    const held = values(revision);
    if (held.some((value) => isDeepStrictEqual(value, revision.value))) continue;
    held.push(revision.value);
    missing.push(revision);
  }
  return missing;
}
/** What a merge writes: the revisions this box lacks, ahead of its own, so its own latest stays the latest. */
function mergedFile(own: File, incoming: readonly Revision[]): File {
  return {
    version: 1,
    revisions: [...missingRevisions(own.revisions, incoming), ...own.revisions],
  };
}
function largestRevisionBytes(revisions: readonly Revision[]): number {
  return revisions.reduce(
    (largest, revision) => Math.max(largest, Buffer.byteLength(JSON.stringify(revision))),
    0,
  );
}
/**
 * Whether this box's file could take `incoming` and keep room, estimated from the file itself, for
 * three more writes: the dormant setup, the wait and the selection. It catches the likely shapes and
 * promises nothing: any further write can still fill the file (the backlog's entry on this file's
 * growth), and a file over its limit makes every later module operation refuse
 * `setup.attempt_invalid`.
 */
export async function modulePreparationMergeFits(
  options: { stateDir: string },
  incoming: readonly { binding: OperationBinding; value: unknown }[],
): Promise<boolean> {
  const own = await readStateFile(options.stateDir);
  // Computed because each revision repeats all earlier entries, so the need grows with the file.
  const room =
    3 * (largestRevisionBytes(incoming) + largestRevisionBytes(own.revisions)) + MERGE_ROOM_FLOOR;
  return preparedBytes(mergedFile(own, incoming).revisions) <= LIMIT - room;
}
/**
 * Writes nothing when this box lacks none of `incoming`. The caller must hold the venue lock: this
 * reads the file and then replaces it.
 */
export async function mergeModulePreparationRevisions(
  options: { stateDir: string },
  incoming: readonly { binding: OperationBinding; value: unknown }[],
): Promise<void> {
  const own = await readStateFile(options.stateDir);
  const merged = mergedFile(own, incoming);
  if (merged.revisions.length === own.revisions.length) return;
  if (preparedBytes(merged.revisions) > LIMIT) invalid();
  for (const module of new Set(incoming.map((row) => row.binding.module)))
    await writePrepared(options.stateDir, merged.revisions, module);
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
      if (!isOperationBinding(bindingInput)) return invalid();
      const binding = { ...bindingInput };
      const body = () =>
        options.withVenueExclusion(async () => {
          await options.authorize({ ...binding });
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
                  await writePrepared(options.stateDir, candidate.revisions, binding.module);
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
