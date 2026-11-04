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
  readonly recoveryRecordDamaged?: true;
  /** The setup database is present and some of it could not be read. */
  readonly databaseUnreadable?: true;
};

/** Written on the repair page, where nobody signs in: the administrator is the setup's own. */
export interface StartAgainConfirmation {
  version: 2;
  at: string;
  attemptId: string;
  database: "missing" | "unreadable";
  setupAdministrator: { displayName: string; email: string };
  confirmedOn: "repair-page";
  signedIn: false;
  ownerGeneration: number;
  shown: StartAgainSummary;
}
type StartAgainConfirmationInput = Omit<
  StartAgainConfirmation,
  "version" | "confirmedOn" | "signedIn"
>;

const FINISHED = new Set(["committed", "publication", "complete"]);
const STARTED = new Set(["activation-started", "uncertain"]);
const NAMED = new Set(["candidates", "import", "consumption-intent"]);

export function startAgainSummary(state: FirstSetupState): StartAgainSummary {
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
  return { reached };
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

function confirmation(value: StartAgainConfirmationInput): StartAgainConfirmation {
  const { at, attemptId, database, setupAdministrator, ownerGeneration, shown } = value as Record<
    string,
    unknown
  >;
  if (
    !isCanonicalInstant(at) ||
    typeof attemptId !== "string" ||
    !isUuid(attemptId) ||
    (database !== "missing" && database !== "unreadable") ||
    !object(setupAdministrator) ||
    !text(setupAdministrator.displayName) ||
    !text(setupAdministrator.email) ||
    !Number.isSafeInteger(ownerGeneration) ||
    (ownerGeneration as number) < 0 ||
    !object(shown) ||
    !(REACHED as readonly unknown[]).includes(shown.reached) ||
    (Object.hasOwn(shown, "recoveryRecordDamaged") && shown.recoveryRecordDamaged !== true) ||
    // Only a present, damaged database is shown as one that cannot be read.
    (database === "unreadable") !== (shown.databaseUnreadable === true) ||
    (Object.hasOwn(shown, "databaseUnreadable") && shown.databaseUnreadable !== true)
  )
    throw invalid();
  return {
    version: 2,
    at,
    attemptId,
    database: database as StartAgainConfirmation["database"],
    setupAdministrator: {
      displayName: setupAdministrator.displayName,
      email: setupAdministrator.email,
    },
    confirmedOn: "repair-page",
    signedIn: false,
    ownerGeneration: ownerGeneration as number,
    shown: {
      reached: shown.reached as StartAgainSummary["reached"],
      ...(shown.recoveryRecordDamaged === true && { recoveryRecordDamaged: true as const }),
      ...(shown.databaseUnreadable === true && { databaseUnreadable: true as const }),
    },
  };
}

/** Each confirmation is a new file; an existing one is never replaced. This module exports no delete. */
export async function writeStartAgainConfirmation(
  stateDir: string,
  record: StartAgainConfirmationInput,
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
