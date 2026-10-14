import { nameOf, statusOf, type CommandObservation } from "@waitron/stream";
import { RECEIPT_APIS } from "./aws-rehearsal-receipt.js";

type Fields = Record<string, unknown>;

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Fields)[key] : undefined;
}

function isCount(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

/**
 * Turns each observed S3 command into receipt events, built only from counts, statuses and names,
 * then hands the observation to `react`. A command outside {@link RECEIPT_APIS} throws.
 */
export function requestRecorder(
  scenario: string,
  record: (event: object) => void,
  react?: (observation: CommandObservation) => void,
): (observation: CommandObservation) => void {
  return (observation) => {
    const api = observation.command.replace(/Command$/, "");
    if (!(RECEIPT_APIS as readonly string[]).includes(api)) {
      throw new Error(`unlisted S3 API: ${api}`);
    }
    const failed = "error" in observation && observation.error !== undefined;
    const answer = failed ? observation.error : observation.output;
    const event: Fields = {
      scenario,
      phase: "request",
      api,
      httpStatus: statusOf(answer),
      elapsedMs: observation.elapsedMs,
      outcome: failed ? "failed" : "ok",
    };
    const attempts = field(field(answer, "$metadata"), "attempts");
    if (isCount(attempts, 1)) event.attempts = attempts;
    if (failed) event.errorName = nameOf(observation.error);
    const events: Fields[] = [event];
    if (api === "DeleteObjects") {
      const objects = field(field(observation.input, "Delete"), "Objects");
      if (Array.isArray(objects)) event.count = objects.length;
      const errors = field(observation.output, "Errors");
      if (Array.isArray(errors) && errors.length > 0) {
        events.push({
          scenario,
          phase: "delete-key-errors",
          api,
          count: errors.length,
          outcome: "failed",
        });
      }
    }
    if (api === "PutObject" || api === "UploadPart") {
      const length = observation.input.ContentLength;
      if (isCount(length, 0)) event.bytes = length;
    }
    for (const each of events) record(each);
    react?.(observation);
  };
}
