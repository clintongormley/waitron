import { join } from "node:path";
import { AppError } from "@waitron/shared";
import {
  type DurableJsonIo,
  readDurableHostJson,
  syncDurableHostJsonFolder,
  writeDurableHostJson,
} from "./durable-host-json.js";
import "./errors.js";

export const START_AGAIN_NOTE_FILE = "first-setup-start-again.json";
const NOTE_LIMIT = 4096;
const KEYS = ["version", "floorMs", "lastName", "module"];
const MODULE_ID = /^[a-z][a-z0-9-]*$/;

export interface StartAgainNote {
  version: 1;
  floorMs: number;
  lastName: string;
  module: string;
}

function parseNote(value: unknown): StartAgainNote {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== KEYS.length ||
    !KEYS.every((key) => Object.hasOwn(value, key))
  )
    throw new AppError("setup.attempt_invalid", {});
  const note = value as Record<string, unknown>;
  if (
    note.version !== 1 ||
    !Number.isSafeInteger(note.floorMs) ||
    typeof note.lastName !== "string" ||
    note.lastName.length < 1 ||
    note.lastName.length > 64 ||
    typeof note.module !== "string" ||
    !MODULE_ID.test(note.module)
  )
    throw new AppError("setup.attempt_invalid", {});
  return {
    version: 1,
    floorMs: note.floorMs as number,
    lastName: note.lastName,
    module: note.module,
  };
}

export async function readStartAgainNote(stateDir: string): Promise<StartAgainNote | null> {
  const value = await readDurableHostJson(join(stateDir, START_AGAIN_NOTE_FILE), NOTE_LIMIT);
  return value === null ? null : parseNote(value);
}

/** The note is only ever replaced by one with a strictly later floor; nothing deletes it. */
export async function raiseStartAgainNote(
  stateDir: string,
  next: Omit<StartAgainNote, "version">,
  io?: DurableJsonIo,
): Promise<StartAgainNote> {
  const candidate = parseNote({ version: 1, ...next });
  const path = join(stateDir, START_AGAIN_NOTE_FILE);
  const current = await readStartAgainNote(stateDir);
  if (current !== null && current.floorMs >= candidate.floorMs) {
    await syncDurableHostJsonFolder(path, io);
    return current;
  }
  await writeDurableHostJson(path, candidate, NOTE_LIMIT, io);
  return candidate;
}

export function startAgainFloorSources(note: StartAgainNote | null): readonly {
  reference: "start-again-note";
  complete: true;
  records: readonly [];
  timeFloorMs: number;
}[] {
  return note === null
    ? []
    : [{ reference: "start-again-note", complete: true, records: [], timeFloorMs: note.floorMs }];
}
