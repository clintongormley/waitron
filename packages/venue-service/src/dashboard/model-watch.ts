import type { LiveData } from "@waitron/dashboard-kit";

/** Re-read with no row written, so today's date and the labels that follow it move on. */
const REFRESH_MS = 60_000;

/** One counter for every watch, so a read's number and a write's hold-back point compare. */
let ticks = 0;

interface Stamped<T> {
  startedAt: number;
  value: T;
}

interface Attached {
  dependencies: readonly string[];
  /** A successful read that started before this is never applied. */
  barrier: number;
  /** Set when there is no live data. */
  read?: () => void;
}

export class ModelWatches {
  readonly #attached = new Set<Attached>();
  readonly #readAt = new WeakMap<object, number>();

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
    const own: Attached = { dependencies, barrier: 0 };
    const stamped = async (): Promise<Stamped<T>> => {
      const startedAt = ++ticks;
      return { startedAt, value: await load() };
    };
    const settle = (
      read: Promise<Stamped<T>>,
      counts: (succeeded: boolean) => boolean = () => true,
    ) =>
      read.then(
        ({ startedAt, value: model }) => {
          if (!attached || !counts(true)) return;
          if (startedAt < own.barrier) return;
          if (typeof model === "object" && model !== null) this.#readAt.set(model, startedAt);
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
        const order = ++started;
        void settle(stamped(), (succeeded) => {
          const newest = order > answered;
          if (newest) answered = order;
          return succeeded ? newest : order === started;
        });
      };
      own.read = read;
      read();
      const timer = setInterval(read, REFRESH_MS);
      this.#attached.add(own);
      return () => {
        attached = false;
        clearInterval(timer);
        this.#attached.delete(own);
      };
    }
    const changed = (): void => {
      const snapshot = observed.snapshot;
      if (snapshot.loading || snapshot.status === "pending") return;
      void settle(
        snapshot.status === "error"
          ? Promise.reject(snapshot.error)
          : Promise.resolve(snapshot.value as Stamped<T>),
      );
    };
    const observed = this.liveData.observe(
      {
        key,
        dependencies: dependencies.map((type) => ({ type })),
        refreshMs: REFRESH_MS,
        read: stamped,
      },
      changed,
    );
    this.#attached.add(own);
    // Observing never calls back by itself: a query another watcher has already read is current
    // and starts no read, so its model is handed over here.
    changed();
    return () => {
      attached = false;
      this.#attached.delete(own);
      observed.unsubscribe();
    };
  }

  /**
   * After a write, has every attached watch read again, so the write shows even when the change
   * feed delivers nothing. With live data it invalidates `dependencies`, and so also rereads every
   * other live query depending on them. Returns the write's hold-back point: no watch it asks to
   * read again applies a successful read that started before it. Weaker than that sounds: it holds
   * back only this object's own watches, and another client object on the same live data still
   * applies them.
   */
  reread(dependencies: readonly string[]): number {
    const at = ++ticks;
    for (const watch of this.#attached) {
      if (
        this.liveData === undefined ||
        watch.dependencies.some((type) => dependencies.includes(type))
      )
        watch.barrier = at;
    }
    if (this.liveData === undefined) for (const watch of this.#attached) watch.read?.();
    else this.liveData.invalidate(dependencies.map((type) => ({ type })));
    return at;
  }

  /** The number the read that produced `model` took when it started, if a watch applied it. */
  readNumberOf(model: object): number | undefined {
    return this.#readAt.get(model);
  }
}
