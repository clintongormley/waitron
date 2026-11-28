import type { TillClockState } from "../api/attendance-api.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { AttendanceSnapshot } from "./attendance.js";
import type { ClockingSnapshot } from "./clocking.js";

export type SignInClockAction = "in" | "break-end";

export function signInClockAction(state: TillClockState): SignInClockAction | false {
  if (state.state === "on_break") return "break-end";
  return state.state === "out" && state.firstClockIn ? "in" : false;
}

export function breakPromptCanClose(
  action: SignInClockAction | false,
  clock: ClockingSnapshot,
): boolean {
  return (
    action === "break-end" &&
    !clock.reading &&
    !clock.busy &&
    clock.state !== null &&
    clock.state.state !== "on_break"
  );
}

export function clockActionUnavailable(
  clock: ClockingSnapshot,
  attendance: AttendanceSnapshot | null,
): boolean {
  return (
    clock.busy ||
    clock.state === null ||
    Boolean(attendance?.busy || attendance?.uncertainCommandId)
  );
}

export function clockMessage({ refusal, error }: ClockingSnapshot): string {
  if (refusal !== null) return codeMessage(refusal.code);
  return error === null
    ? ""
    : t(
        error === "read"
          ? "clock.read_error"
          : error === "write"
            ? "clock.write_error"
            : "clock.uncertain",
      );
}

export function clockActionAfterDeferringQuestions(
  clock: ClockingSnapshot,
  attendance: AttendanceSnapshot | null,
): SignInClockAction | false {
  if (
    clock.state === null ||
    clock.reading ||
    clock.error !== null ||
    clock.refusal !== null ||
    attendance === null ||
    attendance.reading ||
    attendance.uncertainCommandId !== null ||
    (attendance.inbox === null && attendance.readError === null)
  )
    return false;
  return signInClockAction(clock.state);
}
