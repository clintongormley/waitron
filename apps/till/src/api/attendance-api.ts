import type {
  AttendanceInbox,
  HoursSelection,
  PersonHours,
  AttendanceDayView,
  AttendanceCommandResult,
  AttendanceCommand,
} from "@waitron/workforce/attendance-contract";
import { DepartmentTransfersApi } from "./department-transfers-api.js";
import type { StaffMember } from "./device-session-api.js";
import type { TillRequest, ReadOptions } from "./till-request.js";

export type TillClockStatus = "out" | "working" | "on_break";

export interface TillClockState {
  personId: string;
  businessDay: string;
  state: TillClockStatus;
  lastEntryId: string | null;
  firstClockIn: boolean;
}
/** The `absence_kind` members; the server re-validates against the real enum. */
export type AbsenceKind = "holiday" | "sick_leave" | "leave" | "unpaid";
/** One of my upcoming shifts (`GET /api/schedule/shifts`). */
export interface MyShift {
  id: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  description: string | null;
  rosterVersionId: string;
}
/**
 * One swap I'm party to (`GET /api/schedule/swaps`). `direction` says which side I'm on:
 * `offered_to_me` (I can accept it while `status === "requested"`) or `requested_by_me`.
 */
export interface MySwap {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: "requested" | "accepted" | "approved" | "rejected";
  createdAt: string;
  direction: "offered_to_me" | "requested_by_me";
}
/** One of my absences, any status (`GET /api/schedule/absences`). */
export interface MyAbsence {
  id: string;
  personId: string;
  kind: AbsenceKind;
  startsOn: string;
  endsOn: string;
  status: "requested" | "approved" | "rejected";
  note: string | null;
  createdAt: string;
}

export class AttendanceApi extends DepartmentTransfersApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    super(request);
    this.#request = request;
  }
  getClockState(options: ReadOptions = {}): Promise<TillClockState> {
    return this.#request("/api/clock/state", "GET", undefined, options.signal);
  }
  getAttendanceInbox(options: ReadOptions = {}): Promise<AttendanceInbox> {
    return this.#request("/api/attendance/inbox", "GET", undefined, options.signal);
  }
  getHours(selection: HoursSelection, options: ReadOptions = {}): Promise<PersonHours> {
    const query = new URLSearchParams({
      kind: selection.kind,
      ...(selection.date === undefined ? {} : { date: selection.date }),
    });
    return this.#request(`/api/attendance/hours?${query}`, "GET", undefined, options.signal);
  }
  getAttendanceDay(date: string, options: ReadOptions = {}): Promise<AttendanceDayView> {
    const query = new URLSearchParams({ date });
    return this.#request(`/api/attendance/day?${query}`, "GET", undefined, options.signal);
  }
  getAttendanceCommand(
    commandId: string,
    options: ReadOptions = {},
  ): Promise<AttendanceCommandResult | null> {
    return this.#request(
      `/api/attendance/commands/${encodeURIComponent(commandId)}`,
      "GET",
      undefined,
      options.signal,
    );
  }
  listAttendanceApprovers(
    itemId: string,
    action: "approve" | "decline",
    options: ReadOptions = {},
  ): Promise<StaffMember[]> {
    return this.#request(
      `/api/attendance/items/${encodeURIComponent(itemId)}/approvers?action=${action}`,
      "GET",
      undefined,
      options.signal,
    );
  }
  sendAttendanceCommand(
    command: AttendanceCommand,
    override?: { personId: string; pin: string },
    options: ReadOptions = {},
  ): Promise<AttendanceCommandResult> {
    return this.#request(
      "/api/attendance/commands",
      "POST",
      override === undefined ? command : { ...command, override },
      options.signal,
    );
  }
  clockIn(expectedEntryId: string | null, options: ReadOptions = {}): Promise<TillClockState> {
    return this.#request("/api/clock/in", "POST", { expectedEntryId }, options.signal);
  }
  clockOut(expectedEntryId: string | null, options: ReadOptions = {}): Promise<TillClockState> {
    return this.#request("/api/clock/out", "POST", { expectedEntryId }, options.signal);
  }
  startBreak(expectedEntryId: string | null, options: ReadOptions = {}): Promise<TillClockState> {
    return this.#request("/api/clock/break-start", "POST", { expectedEntryId }, options.signal);
  }
  endBreak(expectedEntryId: string | null, options: ReadOptions = {}): Promise<TillClockState> {
    return this.#request("/api/clock/break-end", "POST", { expectedEntryId }, options.signal);
  }
  // --- Staff schedule (`apps/server/src/schedule-api.ts`). The server takes the requester from the
  // session, never from the request body. ---

  /** My shifts over a half-open `[from, to)` window (`YYYY-MM-DD`) → `GET /api/schedule/shifts`. */
  listMyShifts(from: string, to: string): Promise<MyShift[]> {
    return this.#request<MyShift[]>(`/api/schedule/shifts?from=${from}&to=${to}`, "GET");
  }
  /** The swaps I'm party to (offered to me, or requested by me) → `GET /api/schedule/swaps`. */
  listMySwaps(): Promise<MySwap[]> {
    return this.#request<MySwap[]>("/api/schedule/swaps", "GET");
  }
  /**
   * Request a swap → `POST /api/schedule/swaps`: offer one of MY shifts to a colleague; `toShiftId`
   * null is a one-sided give-away. A shift that is not mine rejects `swap.not_permitted`; a
   * `toShiftId` that is not `toPersonId`'s rejects `swap.return_shift_not_owned`.
   */
  requestSwap(req: {
    fromShiftId: string;
    toPersonId: string;
    toShiftId: string | null;
  }): Promise<{ swapId: string }> {
    return this.#request<{ swapId: string }>("/api/schedule/swaps", "POST", req);
  }
  /**
   * Accept a swap offered TO me → `POST /api/schedule/swaps/:swapId/accept`. A swap not offered to me
   * rejects `swap.not_permitted`; one no longer `requested` `swap.not_acceptable`.
   */
  async acceptSwap(swapId: string): Promise<void> {
    await this.#request<void>(`/api/schedule/swaps/${swapId}/accept`, "POST");
  }
  /** My absences, every status → `GET /api/schedule/absences`. */
  listMyAbsences(): Promise<MyAbsence[]> {
    return this.#request<MyAbsence[]>("/api/schedule/absences", "GET");
  }
  /**
   * Request an absence for myself → `POST /api/schedule/absences`. A range overlapping an existing
   * absence rejects `absence.overlaps`.
   */
  requestAbsence(req: {
    kind: AbsenceKind;
    startsOn: string;
    endsOn: string;
    note: string | null;
  }): Promise<{ absenceId: string }> {
    return this.#request<{ absenceId: string }>("/api/schedule/absences", "POST", req);
  }
}
