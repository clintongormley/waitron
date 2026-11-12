import type { FiscalBackend } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import type { StartClockState } from "./start-clock-check.js";
import "./errors.js";

/** The route check, so a route refuses before any card reader, refund send or drawer job, and the
 * four writers, so no path through the seat writes a record past it (plan R6). */
const GATED = new Set<keyof FiscalBackend>([
  "refuseUntilRecordable",
  "recordSale",
  "recordVoid",
  "recordCorrection",
  "recordSubstitution",
]);

/** Whether the gate holds now: on a box that files records, while the start waits or a clock set
 * is with the host, whatever the start's status, since the clock may already have moved where
 * nothing verified it. Each is asked at each call: the role can change while the box runs. */
export function startClockGateHolds(
  state: Pick<StartClockState, "unconfirmed">,
  filesRecords: () => boolean,
  setting: () => boolean,
): () => boolean {
  return () => filesRecords() && (state.unconfirmed() || setting());
}

/** The seat, refusing `clock.unconfirmed` from its route check and its four writers while `holds`
 * answers true; every other member is the seat's own. */
export function gateSeatOnStartClock(backend: FiscalBackend, holds: () => boolean): FiscalBackend {
  return new Proxy(backend, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (
        typeof property !== "string" ||
        !GATED.has(property as keyof FiscalBackend) ||
        typeof value !== "function"
      ) {
        return value;
      }
      return async (...args: unknown[]) => {
        if (holds()) throw new AppError("clock.unconfirmed", {});
        return (value as (...a: unknown[]) => unknown).apply(receiver, args);
      };
    },
  });
}
