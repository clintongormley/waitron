// Re-exporting a core table would create it again in this migration set.
// Guard: `schema-ownership.test.ts`.
export { employments } from "./employments.js";
export { timeEntries, workforceCorrectionStatus, workforceEntryKind } from "./time-entries.js";
export { workforceChains } from "./workforce-chains.js";
export { rosterVersions, rosterVersionStatus } from "./roster-versions.js";
export { shifts } from "./shifts.js";
export { absences, absenceKind, absenceStatus } from "./absences.js";
export { availability } from "./availability.js";
export { shiftTemplates } from "./shift-templates.js";
export { shiftSwaps, shiftSwapStatus } from "./shift-swaps.js";

export { payPeriodSettings } from "./pay-period-settings.js";
export { payPeriodClosures } from "./pay-period-closures.js";
export {
  attendanceDayWork,
  attendanceSourceState,
  attendanceOperationFacts,
  attendanceQuestions,
} from "./attendance.js";

export { attendanceResponseCommands } from "./attendance-responses.js";

// Staffing's tables, which live in workforce's set.
export * from "./staffing/index.js";
