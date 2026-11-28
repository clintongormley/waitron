import type { TillClockState } from "../api/attendance-api.js";
import type { AttendanceSnapshot } from "./attendance.js";
import type { ClockingSnapshot } from "./clocking.js";

export type SignInClockAction = "in" | "break-end";

export function signInClockAction(state: TillClockState): SignInClockAction | false {
  if (state.state === "on_break") return "break-end";
  return state.state === "out" && state.firstClockIn ? "in" : false;
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
