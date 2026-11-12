import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { LiveData, ObservedResource, ResourceQuery } from "./live-data.js";

export class QueryController implements ReactiveController {
  #slots = new Map<string, () => void>();
  #unrecovered = new Set<string>();
  #failing = new Set<string>();
  #lastError: unknown = undefined;
  #failures = 0;

  /** `recovered` is called, with the last error passed to `error`, once every failed slot has since
   * applied a value with no failure in any slot reported while it applied. A released slot is no
   * longer waited for, and an apply that finishes after its observation was released or replaced
   * does not count. */
  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly data: () => LiveData | undefined,
    private readonly error: (error: unknown) => void,
    private readonly recovered?: (error: unknown) => void,
  ) {
    host.addController(this);
  }

  /** Replace a slot's observation when its filters change; resolve after its initial read settles. */
  watch<T>(
    slot: string,
    query: ResourceQuery<T>,
    apply: (value: T) => void | Promise<void>,
  ): Promise<void> {
    this.#slots.get(slot)?.();
    return new Promise((resolve, rejectInitial) => {
      let active = true;
      let initial = true;
      let observed: ObservedResource<T> | undefined = undefined;
      const release = (): void => {
        active = false;
        observed?.unsubscribe();
        resolve();
      };
      this.#slots.set(slot, release);
      const reject = (error: unknown): void => {
        if (active) {
          this.#unrecovered.add(slot);
          this.#markFailing(slot, true);
          this.#lastError = error;
          this.#failures += 1;
          this.error(error);
        }
        if (initial && active) rejectInitial(error);
        else resolve();
        initial = false;
      };
      const accept = async (value: T): Promise<void> => {
        if (active) {
          const failures = this.#failures;
          // Cleared before the apply, so the render the apply schedules already sees it, and a newer
          // read's failure while the apply is pending is never cleared by it.
          this.#markFailing(slot, false);
          try {
            await apply(value);
          } catch (error) {
            reject(error);
            return;
          }
          if (
            active &&
            failures === this.#failures &&
            this.#unrecovered.delete(slot) &&
            this.#unrecovered.size === 0
          )
            this.recovered?.(this.#lastError);
        }
        initial = false;
        resolve();
      };
      const data = this.data();
      if (data === undefined) {
        void Promise.resolve().then(query.read).then(accept, reject);
        return;
      }
      const changed = (): void => {
        const snapshot = observed?.snapshot;
        if (snapshot === undefined || snapshot.loading || snapshot.status === "pending") return;
        if (snapshot.status === "error") reject(snapshot.error);
        else void accept(snapshot.value as T);
      };
      observed = data.observe(query, changed);
      changed();
    });
  }

  /** Whether the slot's latest read, or the apply of its answer, failed; an older apply that throws
   * after a newer answer started also sets it. The host is asked to update whenever this answer
   * changes, except at disconnect, which clears it. */
  failing(slot: string): boolean {
    return this.#failing.has(slot);
  }

  #markFailing(slot: string, failing: boolean): void {
    if (this.#failing.has(slot) === failing) return;
    if (failing) this.#failing.add(slot);
    else this.#failing.delete(slot);
    this.host.requestUpdate();
  }

  release(slot: string): void {
    this.#slots.get(slot)?.();
    this.#slots.delete(slot);
    this.#unrecovered.delete(slot);
    this.#markFailing(slot, false);
  }

  hostDisconnected(): void {
    for (const release of this.#slots.values()) release();
    this.#slots.clear();
    this.#unrecovered.clear();
    this.#failing.clear();
  }
}
