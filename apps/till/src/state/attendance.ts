import {
  isNetworkFailure,
  type AttendanceCommand,
  type AttendanceCommandResult,
  type AttendanceInbox,
  type AttendanceDayView,
  type StaffMember,
  type TillApi,
} from "../api/client.js";

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
  retryCommand: AttendanceCommand | null;
  day: AttendanceDayView | null;
  dayReading: boolean;
  dayError: AttendanceError | null;
  approvers: StaffMember[] | null;
  approversReading: boolean;
  approversError: AttendanceError | null;
}
type EditorValues = { day: AttendanceDayView; approvers: StaffMember[] };
type AttendanceApi = Pick<
  TillApi,
  | "getAttendanceInbox"
  | "getAttendanceDay"
  | "getAttendanceCommand"
  | "listAttendanceApprovers"
  | "sendAttendanceCommand"
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
  approvers: null,
  approversReading: false,
  approversError: null,
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
  #pending: AttendanceCommand | null = null;
  readonly #requests = new Set<AbortController>();
  readonly #editorRequests = new Map<keyof EditorValues, AbortController>();

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
    this.#editorRequests.clear();
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

  async readDay(date: string, locationId: string): Promise<AttendanceDayView | null> {
    const personId = this.#personId;
    return this.#readEditor("day", async (signal) => {
      const day = await this.#api.getAttendanceDay(date, locationId, { signal });
      if (day.personId !== personId || day.date !== date || day.locationId !== locationId)
        throw new TypeError("Attendance day belongs to another selection");
      return day;
    });
  }

  async readApprovers(
    itemId: string,
    action: "approve" | "decline",
  ): Promise<StaffMember[] | null> {
    return this.#readEditor("approvers", (signal) =>
      this.#api.listAttendanceApprovers(itemId, action, { signal }),
    );
  }

  async #readEditor<K extends keyof EditorValues>(
    key: K,
    operation: (signal: AbortSignal) => Promise<EditorValues[K]>,
  ): Promise<EditorValues[K] | null> {
    if (this.#personId === null || this.#snapshot.busy || this.#pending !== null) return null;
    const generation = this.#generation;
    this.#editorRequests.get(key)?.abort();
    const request = new AbortController();
    this.#editorRequests.set(key, request);
    const current = () =>
      generation === this.#generation && this.#editorRequests.get(key) === request;
    this.#snapshot = {
      ...this.#snapshot,
      [key]: null,
      [`${key}Reading`]: true,
      [`${key}Error`]: null,
    };
    this.#publish();
    if (!current()) return null;
    try {
      const answer = await this.#call(request, operation);
      if (!current()) return null;
      this.#snapshot = {
        ...this.#snapshot,
        [key]: answer,
        [`${key}Reading`]: false,
        [`${key}Error`]: null,
      };
      this.#publish();
      return current() ? answer : null;
    } catch (error) {
      if (!current()) return null;
      this.#snapshot = {
        ...this.#snapshot,
        [`${key}Reading`]: false,
        [`${key}Error`]: failure(error, "attendance.read_failed"),
      };
      this.#publish();
      return null;
    } finally {
      if (current()) this.#editorRequests.delete(key);
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

  async act(
    command: AttendanceCommand,
    override?: { personId: string; pin: string },
  ): Promise<AttendanceCommandResult | null> {
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
    for (const request of this.#editorRequests.values()) request.abort();
    this.#editorRequests.clear();
    this.#snapshot = {
      ...this.#snapshot,
      busy: true,
      actionError: null,
      result: null,
      retryCommand: null,
      day: null,
      dayReading: false,
      dayError: null,
      approvers: null,
      approversReading: false,
      approversError: null,
    };
    this.#publish();
    if (generation !== this.#generation) return null;
    try {
      let result: AttendanceCommandResult;
      try {
        result = await this.#call(new AbortController(), (signal) =>
          this.#api.sendAttendanceCommand(sent, override, { signal }),
        );
      } finally {
        override = undefined;
      }
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
