import { AppError } from "@waitron/shared";
import type { NonDbSource } from "@waitron/module";
import { publicHourSelectionHistory } from "./hour-selection.js";
import { projectHourHistory, type HourHistorySource } from "./hour-history.js";
import { projectRepairHourHistory } from "./hour-repair-history.js";
import "./errors.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalid(): never {
  throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
}
function retainedHistory(value: unknown): HourHistorySource {
  if (
    !record(value) ||
    value.reference !== "prepared-hours" ||
    value.complete !== true ||
    !Array.isArray(value.records) ||
    Object.keys(value).length !== (Object.hasOwn(value, "timeFloorMs") ? 4 : 3) ||
    (Object.hasOwn(value, "timeFloorMs") && !Number.isSafeInteger(value.timeFloorMs))
  )
    return invalid();
  // Validate every row before scope filtering; restored evidence cannot carry opaque private fields.
  for (const row of value.records) {
    if (
      !record(row) ||
      Object.keys(row).length !== 8 ||
      ![
        "reference",
        "kind",
        "taxpayerNif",
        "environment",
        "softwareId",
        "nodeId",
        "identity",
        "recordedAtMs",
      ].every((key) => Object.hasOwn(row, key))
    )
      return invalid();
    const checked = projectHourHistory({
      scope: { taxpayerNif: "validation", environment: "preproduction" },
      sources: [{ ...value, records: [row] }],
    });
    if (checked.contradictions.length > 0) return invalid();
  }
  return structuredClone(value) as unknown as HourHistorySource;
}
export const FISCAL_HOUR_BACKUP_STATE: NonDbSource = {
  kind: "preparation-history",
  source: "hour-history",
  project({ preparations, retained, recovery }): HourHistorySource {
    const current = publicHourSelectionHistory(preparations);
    const sources = [...retained.map(retainedHistory), ...projectRepairHourHistory(recovery)];
    const floors = sources.flatMap((source) =>
      source.timeFloorMs === undefined ? [] : [source.timeFloorMs],
    );
    return {
      ...current,
      records: [...sources.flatMap((source) => source.records), ...current.records],
      ...(floors.length === 0 ? {} : { timeFloorMs: Math.max(...floors) }),
    };
  },
};
