import { AppError } from "@waitron/shared";

export function parseAttestation<O extends string>(
  body: Record<string, unknown>,
  outcomes: readonly O[],
): { outcome: O; note: string; pin: unknown } {
  const outcome = body.outcome;
  if (!outcomes.includes(outcome as O)) {
    throw new AppError("management.request_invalid", { field: "outcome" });
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note === "") throw new AppError("management.request_invalid", { field: "note" });
  return { outcome: outcome as O, note, pin: body.pin };
}
