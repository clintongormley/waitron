import { AppError } from "@waitron/shared";
import "./errors.js";
import { EPOCH_MS, decodeMinuteIdentity, isMinuteIdentity } from "./hour-identity.js";

export interface HourScope {
  readonly taxpayerNif: string;
  readonly environment: "production" | "preproduction";
}
export interface HourHistory {
  readonly scope: HourScope;
  readonly greatestSpentMinute: number | null;
  readonly recordedTimeFloorMs: number | null;
  readonly references: readonly string[];
  readonly contradictions: readonly string[];
}
export interface HourHistorySource {
  readonly reference: string;
  readonly complete: boolean;
  readonly records: readonly unknown[];
  readonly timeFloorMs?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
const kinds = new Set([
  "series",
  "activation",
  "reservation",
  "intent",
  "retirement",
  "backup",
  "workspace",
]);

export function projectHourHistory(evidence: unknown): HourHistory {
  if (
    !record(evidence) ||
    !record(evidence.scope) ||
    !text(evidence.scope.taxpayerNif) ||
    (evidence.scope.environment !== "production" &&
      evidence.scope.environment !== "preproduction") ||
    !Array.isArray(evidence.sources)
  )
    throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
  const scope: HourScope = {
    taxpayerNif: evidence.scope.taxpayerNif,
    environment: evidence.scope.environment,
  };
  const sources: unknown[] = evidence.sources;
  let greatestSpentMinute: number | null = null;
  let recordedTimeFloorMs: number | null = null;
  const references = new Set<string>();
  const contradictions = new Set<string>();
  const seen = new Map<string, string>();
  if (sources.length === 0) contradictions.add("missing_sources");
  for (const source of sources) {
    if (
      record(source) &&
      source.reference === "start-again-note" &&
      !(Number.isSafeInteger(source.timeFloorMs) && (source.timeFloorMs as number) >= EPOCH_MS)
    )
      throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
    if (
      !record(source) ||
      !text(source.reference) ||
      !Array.isArray(source.records) ||
      ("timeFloorMs" in source && !Number.isSafeInteger(source.timeFloorMs))
    ) {
      contradictions.add(`${record(source) ? String(source.reference) : "source"}:invalid_source`);
      continue;
    }
    references.add(source.reference);
    if (source.complete !== true) contradictions.add(`${source.reference}:incomplete`);
    if (typeof source.timeFloorMs === "number")
      recordedTimeFloorMs = Math.max(recordedTimeFloorMs ?? source.timeFloorMs, source.timeFloorMs);
    for (const row of source.records) {
      const reference = record(row) && text(row.reference) ? row.reference : source.reference;
      if (
        !record(row) ||
        !text(row.reference) ||
        !text(row.taxpayerNif) ||
        typeof row.environment !== "string" ||
        !["production", "preproduction"].includes(row.environment) ||
        !text(row.softwareId) ||
        !text(row.nodeId) ||
        typeof row.kind !== "string" ||
        !kinds.has(row.kind) ||
        !isMinuteIdentity(row.identity) ||
        (row.recordedAtMs !== null &&
          (!Number.isSafeInteger(row.recordedAtMs) || (row.recordedAtMs as number) < 0))
      ) {
        contradictions.add(`${reference}:invalid_record`);
        continue;
      }
      if (row.taxpayerNif !== scope.taxpayerNif || row.environment !== scope.environment) continue;
      references.add(row.reference);
      const fingerprint = JSON.stringify([
        row.taxpayerNif,
        row.environment,
        row.kind,
        row.softwareId,
        row.nodeId,
        row.identity,
        row.recordedAtMs,
      ]);
      const previous = seen.get(row.reference);
      if (previous !== undefined && previous !== fingerprint)
        contradictions.add(`${row.reference}:conflict`);
      seen.set(row.reference, fingerprint);
      const hour = decodeMinuteIdentity(row.identity);
      greatestSpentMinute = Math.max(greatestSpentMinute ?? hour, hour);
      if (row.recordedAtMs !== null)
        recordedTimeFloorMs = Math.max(
          recordedTimeFloorMs ?? (row.recordedAtMs as number),
          row.recordedAtMs as number,
        );
    }
  }
  return Object.freeze({
    scope: Object.freeze({ ...scope }),
    greatestSpentMinute,
    recordedTimeFloorMs,
    references: Object.freeze([...references]),
    contradictions: Object.freeze([...contradictions]),
  });
}
