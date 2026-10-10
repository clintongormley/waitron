import type { LiveData } from "@waitron/dashboard-kit";

/** Re-read with no row written, so today's date and the labels that follow it move on. */
const REFRESH_MS = 60_000;

export class ModelWatches {
  /** Each attached watch's read when there is no live data, for {@link reread}. */
  readonly #rereads = new Set<() => void>();

  constructor(readonly liveData?: LiveData) {}

  /**
   * Keeps `apply` fed with `load`'s model: on any change to `dependencies`, and on a timer.
   * `failed` hears each failed read and `recovered` the first good one after a failure. The
   * returned function detaches, after which nothing more is read.
   */
  watch<T>(
    key: string,
    dependencies: readonly string[],
    load: () => Promise<T>,
    apply: (model: T) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    let failing = false;
    let attached = true;
    const settle = (read: Promise<T>, counts: (succeeded: boolean) => boolean = () => true) =>
      read.then(
        (model) => {
          if (!attached || !counts(true)) return;
          apply(model);
          if (failing) {
            failing = false;
            recovered();
          }
        },
        (error: unknown) => {
          if (!attached || !counts(false)) return;
          failing = true;
          failed(error);
        },
      );
    if (this.liveData === undefined) {
      // A slow read can answer after a later one. A success is applied only when no read that
      // started after it has answered yet, and a failure shown only when no later read has started.
      let started = 0;
      let answered = 0;
      const read = () => {
        const own = ++started;
        void settle(load(), (succeeded) => {
          const newest = own > answered;
          if (newest) answered = own;
          return succeeded ? newest : own === started;
        });
      };
      read();
      const timer = setInterval(read, REFRESH_MS);
      this.#rereads.add(read);
      return () => {
        attached = false;
        clearInterval(timer);
        this.#rereads.delete(read);
      };
    }
    const changed = (): void => {
      const snapshot = observed.snapshot;
      if (snapshot.loading || snapshot.status === "pending") return;
      void settle(
        snapshot.status === "error"
          ? Promise.reject(snapshot.error)
          : Promise.resolve(snapshot.value as T),
      );
    };
    const observed = this.liveData.observe(
      {
        key,
        dependencies: dependencies.map((type) => ({ type })),
        refreshMs: REFRESH_MS,
        read: load,
      },
      changed,
    );
    // Observing never calls back by itself: a query another watcher has already read is current
    // and starts no read, so its model is handed over here.
    changed();
    return () => {
      attached = false;
      observed.unsubscribe();
    };
  }

  /**
   * After a write, has every attached watch read again, so the write shows even when the change
   * feed delivers nothing. With live data it invalidates `dependencies`, and so also rereads every
   * other live query depending on them.
   */
  reread(dependencies: readonly string[]): void {
    if (this.liveData === undefined) for (const read of this.#rereads) read();
    else this.liveData.invalidate(dependencies.map((type) => ({ type })));
  }
}
