/** Snapshots are kept as given, not copied: callers pass immutable values. */
export class UndoHistory<T> {
  #past: T[] = [];
  #future: T[] = [];
  #current: T;
  #lastMergeKey: string | undefined;

  constructor(initial: T) {
    this.#current = initial;
  }

  get current(): T {
    return this.#current;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  /** Makes `state` current and empties Redo. When `mergeKey` equals the previous push's, and no
   * undo, redo or reset came between, `state` replaces the current one instead of adding a step. */
  push(state: T, mergeKey?: string): void {
    if (mergeKey === undefined || mergeKey !== this.#lastMergeKey) this.#past.push(this.#current);
    this.#current = state;
    this.#future = [];
    this.#lastMergeKey = mergeKey;
  }

  /** The new current state, or undefined (and nothing changes) when there is nothing to undo. */
  undo(): T | undefined {
    if (this.#past.length === 0) return undefined;
    this.#future.push(this.#current);
    this.#current = this.#past.pop() as T;
    this.#lastMergeKey = undefined;
    return this.#current;
  }

  redo(): T | undefined {
    if (this.#future.length === 0) return undefined;
    this.#past.push(this.#current);
    this.#current = this.#future.pop() as T;
    this.#lastMergeKey = undefined;
    return this.#current;
  }

  /** One state, no Undo, no Redo. */
  reset(state: T): void {
    this.#past = [];
    this.#future = [];
    this.#current = state;
    this.#lastMergeKey = undefined;
  }
}
