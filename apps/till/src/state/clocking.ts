import { isNetworkFailure, type TillApi, type TillClockState } from "../api/client.js";

export type TillClockAction = "in" | "out" | "break-start" | "break-end";
export interface ClockingSnapshot {
  state: TillClockState | null;
  reading: boolean;
  busy: boolean;
  error: "read" | "write" | "uncertain" | null;
  refusal: { code: string } | null;
}
type ClockApi = Pick<TillApi, "getClockState" | "clockIn" | "clockOut" | "startBreak" | "endBreak">;
const methods = {
  in: "clockIn",
  out: "clockOut",
  "break-start": "startBreak",
  "break-end": "endBreak",
} as const;
const afterAction = {
  in: "working",
  out: "out",
  "break-start": "on_break",
  "break-end": "working",
} as const;
const empty = (): ClockingSnapshot => ({
  state: null,
  reading: false,
  busy: false,
  error: null,
  refusal: null,
});

function refusal(error: unknown): { code: string } | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? { code } : null;
}

export class ClockingController {
  readonly #api: ClockApi;
  readonly #changed: (snapshot: ClockingSnapshot) => void;
  readonly #settled: (action: TillClockAction, state: TillClockState | null) => void;
  #snapshot = empty();
  #personId: string | null = null;
  #generation = 0;
  #readVersion = 0;
  #readRequest?: AbortController;
  #poll?: ReturnType<typeof setInterval>;
  readonly #requests = new Set<AbortController>();
  #pending: { action: TillClockAction; beforeId: string | null } | null = null;

  constructor(
    api: ClockApi,
    changed: (snapshot: ClockingSnapshot) => void,
    settled: (action: TillClockAction, state: TillClockState | null) => void,
  ) {
    this.#api = api;
    this.#changed = changed;
    this.#settled = settled;
  }

  async start(personId: string): Promise<void> {
    this.stop();
    this.#personId = personId;
    this.#poll = setInterval(() => {
      if (this.#pending === null) void this.refresh();
    }, 15_000);
    await this.#read();
  }

  stop(): void {
    ++this.#generation;
    ++this.#readVersion;
    this.#personId = null;
    this.#pending = null;
    clearInterval(this.#poll);
    this.#poll = undefined;
    for (const request of this.#requests) request.abort();
    this.#readRequest = undefined;
    this.#snapshot = empty();
    this.#publish();
  }

  async refresh(): Promise<void> {
    await this.#read();
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
    const limit = setTimeout(() => request.abort(), 25_000);
    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new DOMException("Clock request timed out or stopped", "AbortError"));
      request.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([operation(request.signal), aborted]);
    } finally {
      clearTimeout(limit);
      request.signal.removeEventListener("abort", onAbort);
      this.#requests.delete(request);
    }
  }

  async #read(): Promise<TillClockState | null> {
    if (this.#personId === null || this.#snapshot.busy || this.#readRequest !== undefined)
      return null;
    const generation = this.#generation;
    const version = ++this.#readVersion;
    const personId = this.#personId;
    const request = new AbortController();
    this.#readRequest = request;
    this.#snapshot = { ...this.#snapshot, reading: true };
    this.#publish();
    if (generation !== this.#generation || version !== this.#readVersion) return null;
    try {
      const state = await this.#call(request, (signal) => this.#api.getClockState({ signal }));
      if (generation !== this.#generation || version !== this.#readVersion) return null;
      if (state.personId !== personId)
        throw new TypeError("Clock state belongs to another operator");
      this.#readRequest = undefined;
      const pending = this.#pending;
      this.#pending = null;
      this.#snapshot = {
        ...this.#snapshot,
        state,
        reading: false,
        error: this.#snapshot.error === "write" ? "write" : null,
        refusal: this.#snapshot.error === "write" ? this.#snapshot.refusal : null,
      };
      this.#publish();
      if (generation !== this.#generation || version !== this.#readVersion) return null;
      if (pending !== null) {
        // A new matching row confirms the current state, not which request wrote that row.
        const confirmed =
          state.state === afterAction[pending.action] &&
          state.lastEntryId !== null &&
          state.lastEntryId !== pending.beforeId;
        this.#settled(pending.action, confirmed ? state : null);
        return confirmed ? state : null;
      }
      return state;
    } catch (error) {
      if (generation !== this.#generation || version !== this.#readVersion) return null;
      this.#readRequest = undefined;
      if (this.#snapshot.error !== "write") {
        this.#snapshot = {
          ...this.#snapshot,
          error: this.#pending === null ? "read" : "uncertain",
          refusal: refusal(error),
        };
      }
      this.#snapshot = { ...this.#snapshot, reading: false };
      this.#publish();
      return null;
    }
  }

  async act(action: TillClockAction): Promise<TillClockState | null> {
    if (
      this.#personId === null ||
      this.#snapshot.state === null ||
      this.#snapshot.busy ||
      this.#pending !== null
    )
      return null;
    const generation = this.#generation;
    const personId = this.#personId;
    const beforeId = this.#snapshot.state.lastEntryId;
    this.#invalidateRead();
    this.#snapshot = { ...this.#snapshot, busy: true, error: null, refusal: null };
    this.#publish();
    if (generation !== this.#generation) return null;
    try {
      const state = await this.#call(new AbortController(), (signal) =>
        this.#api[methods[action]](beforeId, { signal }),
      );
      if (generation !== this.#generation) return null;
      if (state.personId !== personId)
        throw new TypeError("Clock state belongs to another operator");
      this.#invalidateRead();
      this.#snapshot = { state, reading: false, busy: false, error: null, refusal: null };
      this.#publish();
      if (generation !== this.#generation) return null;
      this.#settled(action, state);
      return state;
    } catch (error) {
      if (generation !== this.#generation) return null;
      this.#snapshot = { ...this.#snapshot, busy: false };
      if (isNetworkFailure(error)) {
        this.#pending = { action, beforeId };
        this.#snapshot = { ...this.#snapshot, state: null, error: "uncertain", refusal: null };
        this.#publish();
        if (generation !== this.#generation) return null;
        return this.#read();
      }
      this.#snapshot = { ...this.#snapshot, error: "write", refusal: refusal(error) };
      this.#publish();
      if (generation === this.#generation) this.#settled(action, null);
      return null;
    }
  }
}
