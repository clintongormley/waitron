import type { HoursSelection, PersonHours } from "@waitron/workforce/attendance-contract";
import type { TillApi } from "../api/client.js";

export interface HoursSnapshot {
  view: PersonHours | null;
  reading: boolean;
  readError: { code: string; params?: Record<string, unknown> } | null;
}
type HoursReader = Pick<TillApi, "getHours">;
const empty = (): HoursSnapshot => ({ view: null, reading: false, readError: null });
function sameSelection(a: HoursSelection, b: HoursSelection): boolean {
  return a.kind === b.kind && a.date === b.date;
}
function failure(error: unknown): NonNullable<HoursSnapshot["readError"]> {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const params =
      "params" in error &&
      error.params !== null &&
      typeof error.params === "object" &&
      !Array.isArray(error.params)
        ? (error.params as Record<string, unknown>)
        : undefined;
    return params === undefined ? { code: error.code } : { code: error.code, params };
  }
  return { code: "attendance.read_failed" };
}
export class HoursController {
  #snapshot = empty();
  #personId: string | null = null;
  #locationId = "";
  #selection: HoursSelection = { kind: "week" };
  #version = 0;
  #request?: AbortController;
  constructor(
    private readonly api: HoursReader,
    private readonly changed: (snapshot: HoursSnapshot) => void,
  ) {}
  #publish(): void {
    this.changed({ ...this.#snapshot });
  }
  stop(): void {
    ++this.#version;
    this.#request?.abort();
    this.#request = undefined;
    this.#personId = null;
    this.#snapshot = empty();
    this.#publish();
  }
  async start(personId: string, locationId: string, selection: HoursSelection): Promise<void> {
    this.stop();
    this.#personId = personId;
    await this.select(locationId, selection);
  }
  async select(locationId: string, selection: HoursSelection): Promise<void> {
    if (locationId !== this.#locationId || !sameSelection(selection, this.#selection))
      this.#snapshot = empty();
    this.#locationId = locationId;
    this.#selection = { ...selection };
    await this.refresh();
  }
  async refresh(): Promise<void> {
    if (this.#personId === null) return;
    const version = ++this.#version;
    this.#request?.abort();
    const personId = this.#personId,
      locationId = this.#locationId,
      selection = { ...this.#selection };
    const request = new AbortController();
    this.#request = request;
    const current = () => version === this.#version;
    this.#snapshot = { ...this.#snapshot, reading: true };
    this.#publish();
    if (!current()) return;
    let abort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new DOMException("Hours read stopped or timed out", "AbortError"));
      request.signal.addEventListener("abort", abort, { once: true });
    });
    const timer = setTimeout(() => request.abort(), 25_000);
    try {
      const view = await Promise.race([
        this.api.getHours(locationId, selection, { signal: request.signal }),
        aborted,
      ]);
      if (!current()) return;
      if (
        view.personId !== personId ||
        view.locationId !== locationId ||
        !sameSelection(view.selection, selection)
      )
        throw new TypeError("Hours belongs to another selection");
      this.#snapshot = { view, reading: false, readError: null };
    } catch (error) {
      if (!current()) return;
      this.#snapshot = { ...this.#snapshot, reading: false, readError: failure(error) };
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      if (current()) this.#request = undefined;
    }
    if (current()) this.#publish();
  }
}
