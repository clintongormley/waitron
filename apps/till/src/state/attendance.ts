import {
  isNetworkFailure,
  type AttendanceCommandResult,
  type AttendanceInbox,
  type AttendanceDayView,
  type TillApi,
} from "../api/client.js";
import type { OwnAttendanceCommand } from "@waitron/workforce/attendance-contract";

export interface AttendanceError {
  code: string;
  params?: Record<string, unknown>;
}
export interface AttendanceSnapshot {
  inbox: AttendanceInbox | null;
  reading: boolean;
  busy: boolean;
  uncertainCommandId: string | null;
  readError: AttendanceError | null;
  actionError: AttendanceError | null;
  result: AttendanceCommandResult | null;
  retryCommand: OwnAttendanceCommand | null;
  day: AttendanceDayView | null;
  dayReading: boolean;
  dayError: AttendanceError | null;
}
type AttendanceApi = Pick<
  TillApi,
  "getAttendanceInbox" | "getAttendanceDay" | "getAttendanceCommand" | "sendAttendanceCommand"
>;
const empty = (): AttendanceSnapshot => ({
  inbox: null,
  reading: false,
  busy: false,
  uncertainCommandId: null,
  readError: null,
  actionError: null,
  result: null,
  retryCommand: null,
  day: null,
  dayReading: false,
  dayError: null,
});
function failure(error: unknown, fallback: string): AttendanceError {
  if (error === null || typeof error !== "object") return { code: fallback };
  const { code, ...params } = error as Record<string, unknown>;
  delete params.status;
  if (typeof code !== "string") return { code: fallback };
  return Object.keys(params).length === 0 ? { code } : { code, params };
}

export class AttendanceController {
  readonly #api: AttendanceApi;
  readonly #changed: (snapshot: AttendanceSnapshot) => void;
  #snapshot = empty();
  #personId: string | null = null;
  #generation = 0;
  #readVersion = 0;
  #readRequest?: AbortController;
  #pending: OwnAttendanceCommand | null = null;
  readonly #requests = new Set<AbortController>();
  #dayRequest?: AbortController;

  constructor(api: AttendanceApi, changed: (snapshot: AttendanceSnapshot) => void) {
    this.#api = api;
    this.#changed = changed;
  }

  async start(personId: string): Promise<void> {
    this.stop();
    this.#personId = personId;
    await this.refresh();
  }

  stop(): void {
    ++this.#generation;
    ++this.#readVersion;
    this.#personId = null;
    this.#pending = null;
    for (const request of this.#requests) request.abort();
    this.#readRequest = undefined;
    this.#dayRequest = undefined;
    this.#snapshot = empty();
    this.#publish();
  }

  #publish(): void {
    this.#changed({ ...this.#snapshot });
  }

  #invalidateRead(): void {
    ++this.#readVersion;
    this.#readRequest?.abort();
    this.#readRequest = undefined;
    this.#snapshot = { ...this.#snapshot, reading: false };
  }

  async #call<T>(
    request: AbortController,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.#requests.add(request);
    const timeout = setTimeout(() => request.abort(), 25_000);
    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () =>
        reject(new DOMException("Attendance request timed out or stopped", "AbortError"));
      request.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([operation(request.signal), aborted]);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", onAbort);
      this.#requests.delete(request);
    }
  }

  async refresh(): Promise<void> {
    if (this.#pending !== null) await this.#recover();
    else await this.#read();
  }

  async retryRead(): Promise<void> {
    await this.refresh();
  }

  async readDay(date: string): Promise<AttendanceDayView | null> {
    const personId = this.#personId;
    if (personId === null || this.#snapshot.busy || this.#pending !== null) return null;
    const generation = this.#generation;
    this.#dayRequest?.abort();
    const request = new AbortController();
    this.#dayRequest = request;
    const current = () => generation === this.#generation && this.#dayRequest === request;
    this.#snapshot = { ...this.#snapshot, day: null, dayReading: true, dayError: null };
    this.#publish();
    if (!current()) return null;
    try {
      const day = await this.#call(request, (signal) =>
        this.#api.getAttendanceDay(date, { signal }),
      );
      if (!current()) return null;
      if (day.personId !== personId || day.date !== date)
        throw new TypeError("Attendance day belongs to another selection");
      this.#snapshot = { ...this.#snapshot, day, dayReading: false, dayError: null };
      this.#publish();
      return current() ? day : null;
    } catch (error) {
      if (!current()) return null;
      this.#snapshot = {
        ...this.#snapshot,
        dayReading: false,
        dayError: failure(error, "attendance.read_failed"),
      };
      this.#publish();
      return null;
    } finally {
      if (current()) this.#dayRequest = undefined;
    }
  }

  async #read(): Promise<void> {
    if (this.#personId === null || this.#snapshot.busy || this.#readRequest !== undefined) return;
    const generation = this.#generation;
    const version = ++this.#readVersion;
    const personId = this.#personId;
    const request = new AbortController();
    this.#readRequest = request;
    this.#snapshot = { ...this.#snapshot, reading: true };
    this.#publish();
    if (generation !== this.#generation || version !== this.#readVersion) return;
    try {
      const inbox = await this.#call(request, (signal) => this.#api.getAttendanceInbox({ signal }));
      if (generation !== this.#generation || version !== this.#readVersion) return;
      if (inbox.personId !== personId)
        throw new TypeError("Attendance belongs to another operator");
      this.#readRequest = undefined;
      this.#snapshot = { ...this.#snapshot, inbox, reading: false, readError: null };
    } catch (error) {
      if (generation !== this.#generation || version !== this.#readVersion) return;
      this.#readRequest = undefined;
      this.#snapshot = {
        ...this.#snapshot,
        reading: false,
        readError: failure(error, "attendance.read_failed"),
      };
    }
    this.#publish();
  }

  async #recover(): Promise<AttendanceCommandResult | null> {
    if (this.#personId === null || this.#pending === null || this.#readRequest !== undefined)
      return null;
    const command = this.#pending;
    const generation = this.#generation;
    const version = ++this.#readVersion;
    const request = new AbortController();
    this.#readRequest = request;
    this.#snapshot = { ...this.#snapshot, reading: true };
    this.#publish();
    if (generation !== this.#generation || version !== this.#readVersion) return null;
    try {
      const result = await this.#call(request, (signal) =>
        this.#api.getAttendanceCommand(command.commandId, { signal }),
      );
      if (generation !== this.#generation || version !== this.#readVersion) return null;
      if (result !== null && result.commandId !== command.commandId)
        throw new TypeError("Attendance receipt belongs to another command");
      this.#pending = null;
      this.#readRequest = undefined;
      this.#snapshot = {
        ...this.#snapshot,
        reading: false,
        uncertainCommandId: null,
        readError: null,
        result,
        retryCommand: result === null ? command : null,
        ...(result === null ? { inbox: null } : {}),
      };
      this.#publish();
      if (generation !== this.#generation || version !== this.#readVersion) return null;
      if (result === null) await this.#read();
      return result;
    } catch (error) {
      if (generation !== this.#generation || version !== this.#readVersion) return null;
      this.#readRequest = undefined;
      this.#snapshot = {
        ...this.#snapshot,
        reading: false,
        readError: failure(error, "attendance.read_failed"),
      };
      this.#publish();
      return null;
    }
  }

  async act(command: OwnAttendanceCommand): Promise<AttendanceCommandResult | null> {
    if (
      this.#personId === null ||
      this.#snapshot.inbox === null ||
      this.#snapshot.busy ||
      this.#pending !== null
    )
      return null;
    const generation = this.#generation;
    const sent = structuredClone(command);
    this.#invalidateRead();
    this.#dayRequest?.abort();
    this.#dayRequest = undefined;
    this.#snapshot = {
      ...this.#snapshot,
      busy: true,
      actionError: null,
      result: null,
      retryCommand: null,
      day: null,
      dayReading: false,
      dayError: null,
    };
    this.#publish();
    if (generation !== this.#generation) return null;
    try {
      const result = await this.#call(new AbortController(), (signal) =>
        this.#api.sendAttendanceCommand(sent, { signal }),
      );
      if (generation !== this.#generation) return null;
      if (result.commandId !== sent.commandId)
        throw new TypeError("Attendance result belongs to another command");
      this.#snapshot = { ...this.#snapshot, busy: false, result };
      this.#publish();
      return generation === this.#generation ? result : null;
    } catch (error) {
      if (generation !== this.#generation) return null;
      this.#snapshot = { ...this.#snapshot, busy: false };
      if (isNetworkFailure(error)) {
        this.#pending = sent;
        this.#snapshot = { ...this.#snapshot, uncertainCommandId: sent.commandId };
        this.#publish();
        if (generation !== this.#generation) return null;
        return this.#recover();
      }
      this.#snapshot = {
        ...this.#snapshot,
        actionError: failure(error, "attendance.write_failed"),
      };
      this.#publish();
      return null;
    }
  }
}
