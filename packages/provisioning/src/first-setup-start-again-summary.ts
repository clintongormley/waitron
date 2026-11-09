import type { FirstSetupState } from "./first-setup-state.js";

export type StartAgainSummary = {
  readonly reached: "claimed" | "named" | "fiscal-started" | "fiscal-finished";
  readonly recoveryRecordDamaged?: true;
  /** The setup database is present and some of it could not be read. */
  readonly databaseUnreadable?: true;
};

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

/** An instant written exactly as `toISOString()` writes it. */
export const isCanonicalInstant = (value: unknown): value is string =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(Date.parse(value)).toISOString() === value;
