import type { ResourceIdentity } from "@waitron/shared";
export type { ResourceIdentity } from "@waitron/shared";

export interface ResourceQuery<T> {
  key: string;
  dependencies: readonly ResourceIdentity[];
  read: () => Promise<T>;
  refreshMs?: number;
}

export interface ResourceSnapshot<T> {
  value: T | undefined;
  error: unknown;
  loading: boolean;
  status: "pending" | "ready" | "error";
}

export interface ObservedResource<T> {
  readonly snapshot: ResourceSnapshot<T>;
  unsubscribe(): void;
}

interface Entry {
  query: ResourceQuery<unknown>;
  snapshot: ResourceSnapshot<unknown>;
  listeners: Set<() => void>;
  dirty: boolean;
  scheduled: boolean;
  active: boolean;
  timer?: ReturnType<typeof setInterval>;
}

/** Session-owned snapshots shared by mounted observers. Query keys include all request parameters. */
export class LiveData {
  #entries = new Map<string, Entry>();
  #interestListeners = new Set<() => void>();

  get interests(): ResourceIdentity[] {
    const interests = new Map<string, ResourceIdentity>();
    for (const entry of this.#entries.values()) {
      for (const identity of entry.query.dependencies)
        interests.set(JSON.stringify(identity), identity);
    }
    return [...interests.values()];
  }

  subscribeToInterests(changed: () => void): () => void {
    this.#interestListeners.add(changed);
    return () => {
      this.#interestListeners.delete(changed);
    };
  }

  #interestsChanged(): void {
    for (const listener of this.#interestListeners) listener();
  }

  observe<T>(query: ResourceQuery<T>, changed: () => void): ObservedResource<T> {
    let entry = this.#entries.get(query.key);
    if (entry === undefined) {
      entry = {
        query,
        snapshot: { value: undefined, error: undefined, loading: false, status: "pending" },
        listeners: new Set(),
        dirty: true,
        scheduled: false,
        active: true,
      };
      this.#entries.set(query.key, entry);
      this.#interestsChanged();
      if (query.refreshMs !== undefined) {
        const timed = entry;
        timed.timer = setInterval(() => {
          timed.dirty = true;
          this.#schedule(timed);
        }, query.refreshMs);
      }
    }
    const held = entry;
    // Each observation owns its subscription, even when two observations share a callback.
    const listener = (): void => changed();
    held.listeners.add(listener);
    this.#schedule(held);
    return {
      get snapshot() {
        return held.snapshot as ResourceSnapshot<T>;
      },
      unsubscribe: () => {
        held.listeners.delete(listener);
        if (held.listeners.size === 0) {
          held.active = false;
          clearInterval(held.timer);
          if (this.#entries.get(query.key) === held) {
            this.#entries.delete(query.key);
            this.#interestsChanged();
          }
        }
      },
    };
  }

  refresh(): void {
    for (const entry of this.#entries.values()) {
      entry.dirty = true;
      this.#schedule(entry);
    }
  }

  clear(): void {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    this.#interestsChanged();
    for (const entry of entries) {
      entry.active = false;
      clearInterval(entry.timer);
      entry.snapshot = { value: undefined, error: undefined, loading: false, status: "pending" };
      for (const listener of entry.listeners) listener();
      entry.listeners.clear();
    }
  }

  invalidate(resources: readonly ResourceIdentity[]): void {
    for (const entry of this.#entries.values()) {
      if (
        entry.query.dependencies.some((dependency) =>
          resources.some(
            (resource) =>
              dependency.type === resource.type &&
              (dependency.id === undefined ||
                resource.id === undefined ||
                dependency.id === resource.id),
          ),
        )
      ) {
        entry.dirty = true;
        this.#schedule(entry);
      }
    }
  }

  #schedule(entry: Entry): void {
    if (!entry.active || !entry.dirty || entry.scheduled || entry.snapshot.loading) return;
    entry.scheduled = true;
    queueMicrotask(() => {
      entry.scheduled = false;
      if (entry.active) void this.#read(entry);
    });
  }

  async #read(entry: Entry): Promise<void> {
    entry.dirty = false;
    entry.snapshot = { ...entry.snapshot, loading: true };
    for (const listener of entry.listeners) listener();
    try {
      const value = await entry.query.read();
      if (!entry.active) return;
      entry.snapshot = { value, error: undefined, loading: false, status: "ready" };
    } catch (error) {
      if (!entry.active) return;
      entry.snapshot = { ...entry.snapshot, error, loading: false, status: "error" };
    }
    if (!entry.active) return;
    for (const listener of entry.listeners) listener();
    this.#schedule(entry);
  }
}
