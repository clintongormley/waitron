import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { AppError, isUuid } from "@waitron/shared";
import { writeDurableHostJson } from "./durable-host-json.js";
import type { FirstSetupState } from "./first-setup-state.js";
import "./errors.js";

export const START_AGAIN_CONFIRMATIONS_DIR = "first-setup-start-again-confirmations";
const CONFIRMATION_LIMIT = 16 * 1024;
const REACHED = ["claimed", "named", "fiscal-started", "fiscal-finished"] as const;

export type StartAgainSummary = {
  readonly reached: (typeof REACHED)[number];
  readonly lastName: string | null;
  readonly recoveryRecordDamaged?: true;
  readonly recovery?: StartAgainRecoveryShown;
  readonly unreadable?: StartAgainUnreadable;
};

const UNREADABLE_RECORDS = ["series-picks", "public-record", "fiscal-documents"] as const;

export type StartAgainUnreadable = {
  readonly records: readonly (typeof UNREADABLE_RECORDS)[number][];
  readonly floorMs: number;
};

/** A stopped backup recovery that Start again would discard, as the summary showed it. */
export type StartAgainRecoveryShown = {
  readonly startedAt: string;
  readonly lastActiveAt: string;
  readonly lastActiveSource: "memory" | "saved-step";
  readonly lastName: string | null;
  readonly failed: boolean;
  readonly cloud: boolean;
};

export interface StartAgainConfirmation {
  version: 1;
  at: string;
  attemptId: string;
  database: "missing" | "present";
  administrator: { displayName: string; email: string };
  ownerGeneration: number;
  shown: StartAgainSummary;
}

const FINISHED = new Set(["committed", "publication", "complete"]);
const STARTED = new Set(["activation-started", "uncertain"]);
const NAMED = new Set(["candidates", "import", "consumption-intent"]);

export function startAgainSummary(
  state: FirstSetupState,
  lastName: string | null,
): StartAgainSummary {
  const attempts = [state, ...state.previous];
  const kinds = new Set(attempts.flatMap((attempt) => attempt.history.map((event) => event.kind)));
  const has = (set: Set<string>) => [...set].some((kind) => kinds.has(kind));
  const reached =
    attempts.some((attempt) => attempt.result !== null) || has(FINISHED)
      ? "fiscal-finished"
      : has(STARTED)
        ? "fiscal-started"
        : has(NAMED)
          ? "named"
          : "claimed";
  return { reached, lastName };
}

const invalid = () => new AppError("setup.attempt_invalid", {});
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
/** An instant written exactly as `toISOString()` writes it. */
export const isCanonicalInstant = (value: unknown): value is string =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(Date.parse(value)).toISOString() === value;

function recoveryShown(value: unknown): StartAgainRecoveryShown {
  if (
    !object(value) ||
    !isCanonicalInstant(value.startedAt) ||
    !isCanonicalInstant(value.lastActiveAt) ||
    !["memory", "saved-step"].includes(value.lastActiveSource as string) ||
    (value.lastName !== null && !text(value.lastName)) ||
    typeof value.failed !== "boolean" ||
    typeof value.cloud !== "boolean"
  )
    throw invalid();
  return {
    startedAt: value.startedAt,
    lastActiveAt: value.lastActiveAt,
    lastActiveSource: value.lastActiveSource as StartAgainRecoveryShown["lastActiveSource"],
    lastName: value.lastName as string | null,
    failed: value.failed,
    cloud: value.cloud,
  };
}

/** Records named in the fixed order, each at most once. */
function unreadableShown(value: unknown): StartAgainUnreadable {
  if (
    !object(value) ||
    Object.keys(value).some((key) => key !== "records" && key !== "floorMs") ||
    !Array.isArray(value.records) ||
    value.records.length === 0 ||
    !Number.isSafeInteger(value.floorMs)
  )
    throw invalid();
  const positions = value.records.map((record) =>
    (UNREADABLE_RECORDS as readonly unknown[]).indexOf(record),
  );
  if (
    positions.some(
      (position, index) => position < 0 || (index > 0 && position <= positions[index - 1]!),
    )
  )
    throw invalid();
  return {
    records: value.records as StartAgainUnreadable["records"],
    floorMs: value.floorMs as number,
  };
}

function confirmation(value: Omit<StartAgainConfirmation, "version">): StartAgainConfirmation {
  const { at, attemptId, database, administrator, ownerGeneration, shown } = value as Record<
    string,
    unknown
  >;
  if (
    !isCanonicalInstant(at) ||
    typeof attemptId !== "string" ||
    !isUuid(attemptId) ||
    (database !== "missing" && database !== "present") ||
    !object(administrator) ||
    !text(administrator.displayName) ||
    !text(administrator.email) ||
    !Number.isSafeInteger(ownerGeneration) ||
    (ownerGeneration as number) < 0 ||
    !object(shown) ||
    !(REACHED as readonly unknown[]).includes(shown.reached) ||
    (shown.lastName !== null && typeof shown.lastName !== "string") ||
    (Object.hasOwn(shown, "recoveryRecordDamaged") && shown.recoveryRecordDamaged !== true) ||
    // With the database present, a Start again writes a record only when it discards a recovery
    // or goes past damaged name records.
    (database === "present" &&
      !Object.hasOwn(shown, "recovery") &&
      !Object.hasOwn(shown, "unreadable"))
  )
    throw invalid();
  return {
    version: 1,
    at,
    attemptId,
    database: database as StartAgainConfirmation["database"],
    administrator: { displayName: administrator.displayName, email: administrator.email },
    ownerGeneration: ownerGeneration as number,
    shown: {
      reached: shown.reached as StartAgainSummary["reached"],
      lastName: shown.lastName as string | null,
      ...(shown.recoveryRecordDamaged === true && { recoveryRecordDamaged: true as const }),
      ...(Object.hasOwn(shown, "recovery") && { recovery: recoveryShown(shown.recovery) }),
      ...(Object.hasOwn(shown, "unreadable") && { unreadable: unreadableShown(shown.unreadable) }),
    },
  };
}

/** Each confirmation is a new file; an existing one is never replaced. This module exports no delete. */
export async function writeStartAgainConfirmation(
  stateDir: string,
  record: Omit<StartAgainConfirmation, "version">,
): Promise<string> {
  const value = confirmation(record);
  const name = `${Date.parse(value.at)}-${value.attemptId}.json`;
  const path = join(stateDir, START_AGAIN_CONFIRMATIONS_DIR, name);
  const existing = await lstat(path).then(
    () => true,
    (error: unknown) => {
      if (object(error) && error.code === "ENOENT") return false;
      throw invalid();
    },
  );
  if (existing) throw new AppError("setup.attempt_conflict", {});
  await writeDurableHostJson(path, value, CONFIRMATION_LIMIT);
  return name;
}
