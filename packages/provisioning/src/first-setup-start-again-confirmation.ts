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
};

export interface StartAgainConfirmation {
  version: 1;
  at: string;
  attemptId: string;
  database: "missing";
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

function confirmation(value: Omit<StartAgainConfirmation, "version">): StartAgainConfirmation {
  const { at, attemptId, database, administrator, ownerGeneration, shown } = value as Record<
    string,
    unknown
  >;
  if (
    typeof at !== "string" ||
    !Number.isFinite(Date.parse(at)) ||
    new Date(Date.parse(at)).toISOString() !== at ||
    typeof attemptId !== "string" ||
    !isUuid(attemptId) ||
    database !== "missing" ||
    !object(administrator) ||
    !text(administrator.displayName) ||
    !text(administrator.email) ||
    !Number.isSafeInteger(ownerGeneration) ||
    (ownerGeneration as number) < 0 ||
    !object(shown) ||
    !(REACHED as readonly unknown[]).includes(shown.reached) ||
    (shown.lastName !== null && typeof shown.lastName !== "string")
  )
    throw invalid();
  return {
    version: 1,
    at,
    attemptId,
    database,
    administrator: { displayName: administrator.displayName, email: administrator.email },
    ownerGeneration: ownerGeneration as number,
    shown: {
      reached: shown.reached as StartAgainSummary["reached"],
      lastName: shown.lastName as string | null,
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
