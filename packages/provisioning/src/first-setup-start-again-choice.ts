import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { AppError, isUuid } from "@waitron/shared";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import { isCanonicalInstant } from "./first-setup-start-again-confirmation.js";
import { readStartAgainMarker } from "./first-setup-start-again-deletion.js";
import type { StartAgainEntry, StartAgainUnit } from "./first-setup-start-again-leftovers.js";
import {
  START_AGAIN_CHOICES_DIR,
  START_AGAIN_SET_ASIDE_DIR,
} from "./first-setup-start-again-names.js";
import "./errors.js";

export { START_AGAIN_CHOICES_DIR };

export interface StartAgainChoiceRecord {
  readonly version: 1;
  readonly at: string;
  readonly attemptId: string;
  readonly frozenDigest: string;
  readonly markerSha256: string;
  readonly choice: "keep" | "move";
  readonly administrator: {
    readonly administratorId: string;
    readonly displayName: string;
    readonly email: string;
  };
  readonly ownerGeneration: number;
  readonly listed: { readonly digest: string; readonly units: readonly StartAgainUnit[] };
  /** Folders relative to their roots; null for keep. */
  readonly setAside: { readonly state: string; readonly venue: string } | null;
  /** The floor a Move raises the note to; null for keep. */
  readonly noteFloorMs: number | null;
}

const CHOICE_LIMIT = 8 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const DIGITS = /^\d+$/;
const NAME = /^(\d+)-([0-9a-f-]{36})\.json$/i;

class Damaged extends Error {}
const damaged = (): never => {
  throw new Damaged();
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const hash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
const segment = (name: string) =>
  name !== "" && name !== "." && name !== ".." && !name.includes("\0");
/** A "/"-separated path that stays inside the folder it is relative to. */
const relative = (value: unknown): value is string =>
  typeof value === "string" && value.split("/").every(segment);
const setAsidePath = (value: unknown) =>
  relative(value) && value.startsWith(`${START_AGAIN_SET_ASIDE_DIR}/`);
const digitsOrNull = (value: unknown) =>
  value === null || (typeof value === "string" && DIGITS.test(value));
const incomplete = (reason: string) => new AppError("setup.start_again_incomplete", {}, { reason });

function entry(value: unknown): StartAgainEntry {
  if (
    !exactKeys(value, ["path", "type", "ino", "size", "mtimeNs"]) ||
    !relative(value.path) ||
    (value.type !== "file" && value.type !== "folder") ||
    typeof value.ino !== "string" ||
    !DIGITS.test(value.ino) ||
    !digitsOrNull(value.size) ||
    !digitsOrNull(value.mtimeNs)
  )
    return damaged();
  return {
    path: value.path,
    type: value.type,
    ino: value.ino,
    size: value.size as string | null,
    mtimeNs: value.mtimeNs as string | null,
  };
}

function unit(value: unknown): StartAgainUnit {
  if (
    !exactKeys(value, ["root", "path", "why", "pieces", "entries"]) ||
    (value.root !== "venue" && value.root !== "state") ||
    !relative(value.path) ||
    (value.why !== "not-created" && value.why !== "changed") ||
    !Array.isArray(value.pieces) ||
    !value.pieces.every(relative) ||
    !Array.isArray(value.entries)
  )
    return damaged();
  return {
    root: value.root,
    path: value.path,
    why: value.why,
    pieces: [...value.pieces],
    entries: value.entries.map(entry),
  };
}

function parseChoice(value: unknown): StartAgainChoiceRecord {
  const keys = [
    "version",
    "at",
    "attemptId",
    "frozenDigest",
    "markerSha256",
    "choice",
    "administrator",
    "ownerGeneration",
    "listed",
    "setAside",
    "noteFloorMs",
  ];
  if (!exactKeys(value, keys)) return damaged();
  const { at, attemptId, frozenDigest, markerSha256, choice, administrator } = value;
  const { ownerGeneration, listed, setAside, noteFloorMs } = value;
  const keep = choice === "keep";
  if (
    value.version !== 1 ||
    !isCanonicalInstant(at) ||
    typeof attemptId !== "string" ||
    !isUuid(attemptId) ||
    attemptId !== attemptId.toLowerCase() ||
    !hash(frozenDigest) ||
    !hash(markerSha256) ||
    (choice !== "keep" && choice !== "move") ||
    !exactKeys(administrator, ["administratorId", "displayName", "email"]) ||
    typeof administrator.administratorId !== "string" ||
    !isUuid(administrator.administratorId) ||
    !text(administrator.displayName) ||
    !text(administrator.email) ||
    !Number.isSafeInteger(ownerGeneration) ||
    (ownerGeneration as number) < 0 ||
    !exactKeys(listed, ["digest", "units"]) ||
    !hash(listed.digest) ||
    !Array.isArray(listed.units) ||
    (keep
      ? setAside !== null || noteFloorMs !== null
      : !exactKeys(setAside, ["state", "venue"]) ||
        !setAsidePath(setAside.state) ||
        !setAsidePath(setAside.venue) ||
        (noteFloorMs !== null &&
          (!Number.isSafeInteger(noteFloorMs) || (noteFloorMs as number) < 0)))
  )
    return damaged();
  return {
    version: 1,
    at,
    attemptId,
    frozenDigest,
    markerSha256,
    choice,
    administrator: {
      administratorId: administrator.administratorId,
      displayName: administrator.displayName,
      email: administrator.email,
    },
    ownerGeneration: ownerGeneration as number,
    listed: { digest: listed.digest, units: listed.units.map(unit) },
    setAside: keep
      ? null
      : {
          state: (setAside as { state: string }).state,
          venue: (setAside as { venue: string }).venue,
        },
    noteFloorMs: noteFloorMs as number | null,
  };
}

/** A choice's name, its record's file name without `.json`; the set-aside folders are named by it too. */
export const startAgainChoiceStem = (record: Pick<StartAgainChoiceRecord, "at" | "attemptId">) =>
  `${Date.parse(record.at)}-${record.attemptId.toLowerCase()}`;

/**
 * Each choice is a new file; an existing one is never replaced. This module exports no delete. The
 * attempt id is stored lower-cased, as a marker may spell it in either case. Returns the stem.
 */
export async function writeStartAgainChoice(
  stateDir: string,
  record: Omit<StartAgainChoiceRecord, "version">,
): Promise<string> {
  let value: StartAgainChoiceRecord;
  try {
    const { attemptId } = record as { attemptId: unknown };
    value = parseChoice({
      version: 1,
      ...record,
      attemptId: typeof attemptId === "string" ? attemptId.toLowerCase() : attemptId,
    });
  } catch {
    throw new AppError("setup.attempt_invalid", {});
  }
  const stem = startAgainChoiceStem(value);
  const path = join(stateDir, START_AGAIN_CHOICES_DIR, `${stem}.json`);
  const existing = await lstat(path).then(
    () => true,
    (error: unknown) => {
      if (object(error) && error.code === "ENOENT") return false;
      throw new AppError("setup.attempt_invalid", {});
    },
  );
  if (existing) throw new AppError("setup.attempt_conflict", {});
  await writeDurableHostJson(path, value, CHOICE_LIMIT);
  return stem;
}

/**
 * The marker's records, by name, oldest first. A record whose name is for the marker's attempt
 * but which does not parse, or does not match its name, refuses; another frozen digest is skipped.
 */
export async function readStartAgainChoices(
  stateDir: string,
  marker: { attemptId: string; frozenDigest: string },
): Promise<StartAgainChoiceRecord[]> {
  const folder = join(stateDir, START_AGAIN_CHOICES_DIR);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch (error) {
    if (object(error) && error.code === "ENOENT") return [];
    throw incomplete("choice records unreadable");
  }
  const attemptId = marker.attemptId.toLowerCase();
  const mine = names
    .map((name) => ({ name, match: NAME.exec(name) }))
    .filter(({ match }) => match !== null && match[2]!.toLowerCase() === attemptId)
    .map(({ name, match }) => ({ name, ms: Number(match![1]) }))
    .sort((a, b) => a.ms - b.ms);
  const records: StartAgainChoiceRecord[] = [];
  for (const { name } of mine) {
    let record: StartAgainChoiceRecord;
    try {
      record = parseChoice(await readDurableHostJson(join(folder, name), CHOICE_LIMIT));
      if (`${startAgainChoiceStem(record)}.json` !== name) damaged();
    } catch {
      throw incomplete(`choice record damaged: ${name}`);
    }
    if (record.frozenDigest === marker.frozenDigest) records.push(record);
  }
  return records;
}

/** Refuses while the pending marker's attempt has a recorded Keep. No marker, nothing to keep. */
export async function assertStartAgainNotKept(roots: {
  stateDir: string;
  venueDir: string;
}): Promise<void> {
  const marker = await readStartAgainMarker(roots.venueDir);
  if (marker === null) return;
  const records = await readStartAgainChoices(roots.stateDir, marker);
  if (records.some((record) => record.choice === "keep"))
    throw new AppError("setup.start_again_kept", {});
}
