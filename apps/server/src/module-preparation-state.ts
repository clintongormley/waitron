import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import "./errors.js";
import {
  firstSetupAnchorFor,
  readDurableHostJson,
  writeDurableHostJson,
  type FirstSetupCoordinator,
  type FirstSetupHold,
} from "@waitron/provisioning";
import type { OperationBinding } from "@waitron/module";

interface Revision {
  binding: OperationBinding;
  value: unknown;
}
interface File {
  version: 1;
  revisions: Revision[];
}
interface Options {
  stateDir: string;
  venueDir: string;
  coordinator: FirstSetupCoordinator;
  authorize(binding: OperationBinding): Promise<void>;
  authorizeReplacement?(): Promise<void>;
  withVenueExclusion<T>(run: () => Promise<T>): Promise<T>;
}
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
  for (const revision of value.revisions) {
    if (
      !record(revision) ||
      Object.keys(revision).length !== 2 ||
      !validBinding(revision.binding) ||
      !Object.hasOwn(revision, "value")
    )
      return invalid();
  }
  return value as unknown as File;
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
export function createModulePreparationState(options: Options) {
  return {
    async withState<T>(
      bindingInput: OperationBinding,
      run: (state: {
        readonly value: unknown;
        readonly history: readonly unknown[];
        replace(value: unknown): Promise<void>;
      }) => Promise<T>,
      hold?: FirstSetupHold,
    ): Promise<T> {
      if (!validBinding(bindingInput)) return invalid();
      const binding = { ...bindingInput };
      const body = () =>
        options.withVenueExclusion(async () => {
          await options.authorize({ ...binding });
          const anchor = await firstSetupAnchorFor(options);
          const path = join(anchor.stateDir, "module-preparation-state.json");
          const file = parse(await readDurableHostJson(path, LIMIT));
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
              async replace(next) {
                check();
                const supplied = snapshot(next);
                writes = writes.then(async () => {
                  check();
                  await options.authorize({ ...binding });
                  await options.authorizeReplacement?.();
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
