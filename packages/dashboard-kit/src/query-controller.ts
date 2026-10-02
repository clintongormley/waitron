import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { LiveData, ObservedResource, ResourceQuery } from "./live-data.js";

export class QueryController implements ReactiveController {
  #slots = new Map<string, () => void>();
  #failing = new Set<string>();
  #lastError: unknown = undefined;

  /** `recovered` is called once every slot whose failure reached `error` has applied a value again,
   * with the last error passed to `error`, so the view can clear the message it showed for it. */
  constructor(
    host: ReactiveControllerHost,
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
          this.#failing.add(slot);
          this.#lastError = error;
          this.error(error);
        }
        if (initial && active) rejectInitial(error);
        else resolve();
        initial = false;
      };
      const accept = async (value: T): Promise<void> => {
        if (active) {
          try {
            await apply(value);
          } catch (error) {
            reject(error);
            return;
          }
          if (this.#failing.delete(slot) && this.#failing.size === 0)
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

  release(slot: string): void {
    this.#slots.get(slot)?.();
    this.#slots.delete(slot);
    this.#failing.delete(slot);
  }

  hostDisconnected(): void {
    for (const release of this.#slots.values()) release();
    this.#slots.clear();
    this.#failing.clear();
  }
}
