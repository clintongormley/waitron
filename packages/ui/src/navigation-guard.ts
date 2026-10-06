import type { LeaveOutcome } from "@waitron/ui-core/unsaved-changes";

export interface NavigationLeave {
  isDirty(): boolean;
  request(
    proceed: () => void | Promise<void>,
    signal: AbortSignal,
    destination: string,
  ): Promise<LeaveOutcome>;
}

interface Position {
  epoch: string;
  index: number;
}
interface Entry {
  href: string;
  state: unknown;
  position: Position | undefined;
}
interface Attempt {
  controller: AbortController;
  destination: Entry;
  replaying: boolean;
  settled: (() => void)[];
}

const namespace = "__wtNavigation";
const acceptedEvent = "wt-route-accepted";
const guards = new WeakMap<Window, NavigationGuard>();

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function position(state: unknown): Position | undefined {
  const tag = record(record(state)[namespace]);
  return typeof tag["epoch"] === "string" && Number.isSafeInteger(tag["index"])
    ? { epoch: tag["epoch"], index: tag["index"] as number }
    : undefined;
}

export function navigationGuardFor(target: Window): NavigationGuard | undefined {
  return guards.get(target);
}

export function observeNavigation(target: Window, restore: () => void): () => void {
  const pop = () => {
    if (!guards.has(target)) restore();
  };
  target.addEventListener("popstate", pop);
  target.addEventListener(acceptedEvent, restore);
  return () => {
    target.removeEventListener("popstate", pop);
    target.removeEventListener(acceptedEvent, restore);
  };
}

export class NavigationGuard {
  private accepted: Entry;
  private pending?: Attempt;
  private disposed = false;

  constructor(
    private readonly target: Window,
    private readonly leave: NavigationLeave,
  ) {
    if (guards.has(target)) throw new Error("A document already has a navigation guard");
    this.accepted = this.indexed(this.read(), { epoch: crypto.randomUUID(), index: 0 });
    guards.set(target, this);
    target.addEventListener("popstate", this.onPop);
  }

  get href(): string {
    return this.accepted.href;
  }

  private read(): Entry {
    const state: unknown = this.target.history.state;
    return { href: this.target.location.href, state, position: position(state) };
  }

  private indexed(entry: Entry, at: Position): Entry {
    const state = { ...record(entry.state), [namespace]: at };
    this.target.history.replaceState(state, "", entry.href);
    return { ...entry, state, position: at };
  }

  private publish(entry: Entry): void {
    this.accepted = entry;
    const attempt = this.pending;
    this.pending = undefined;
    if (attempt) this.release(attempt);
    this.target.dispatchEvent(new Event(acceptedEvent));
  }

  private same(entry: Entry, other: Entry): boolean {
    return (
      entry.href === other.href &&
      entry.position?.epoch === other.position?.epoch &&
      entry.position?.index === other.position?.index
    );
  }

  private comparable(entry: Entry): boolean {
    return entry.position?.epoch === this.accepted.position!.epoch;
  }

  private release(attempt: Attempt): void {
    for (const finish of attempt.settled.splice(0)) finish();
  }

  private restore(entry: Entry, attempt: Attempt): void {
    if (this.same(entry, this.accepted)) {
      this.release(attempt);
    } else if (this.comparable(entry) && entry.position!.index !== this.accepted.position!.index) {
      this.target.history.go(this.accepted.position!.index - entry.position!.index);
    } else {
      // An unknown entry has no measured traversal distance; replace it without adding history.
      this.accepted = this.indexed(this.accepted, { epoch: crypto.randomUUID(), index: 0 });
      this.release(attempt);
    }
  }

  private restored(attempt: Attempt): Promise<void> {
    if (this.disposed || this.same(this.read(), this.accepted)) return Promise.resolve();
    return new Promise((resolve) => attempt.settled.push(resolve));
  }

  private async decide(
    attempt: Attempt,
    proceed: () => void | Promise<void>,
  ): Promise<LeaveOutcome> {
    try {
      if (!this.same(this.read(), this.accepted)) await this.restored(attempt);
      if (this.disposed || this.pending !== attempt) return "stale";
      return await this.leave.request(
        async () => {
          if (!this.same(this.read(), this.accepted)) await this.restored(attempt);
          if (!this.disposed && this.pending === attempt) await proceed();
        },
        attempt.controller.signal,
        attempt.destination.href,
      );
    } finally {
      if (this.pending === attempt) this.pending = undefined;
    }
  }

  write(href: string | URL, replace = false): Promise<LeaveOutcome> {
    if (this.disposed) return Promise.resolve("stale");
    if (this.pending) return Promise.resolve("busy");
    const url = new URL(href, this.accepted.href);
    if (url.origin !== this.target.location.origin)
      throw new Error("Navigation must stay in this app");
    if (url.href === this.accepted.href) return Promise.resolve("proceeded");
    const attempt: Attempt = {
      controller: new AbortController(),
      destination: { href: url.href, state: this.accepted.state, position: undefined },
      replaying: false,
      settled: [],
    };
    this.pending = attempt;
    // Clean writes stay synchronous for existing route handlers; only dirty leaves wait.
    if (!this.leave.isDirty()) {
      this.writeAccepted(attempt.destination, replace);
      return Promise.resolve("proceeded");
    }
    return this.decide(attempt, () => this.writeAccepted(attempt.destination, replace));
  }

  private writeAccepted(entry: Entry, replace: boolean): void {
    const at = {
      ...this.accepted.position!,
      index: this.accepted.position!.index + (replace ? 0 : 1),
    };
    const state = { ...record(entry.state), [namespace]: at };
    if (replace) this.target.history.replaceState(state, "", entry.href);
    else this.target.history.pushState(state, "", entry.href);
    this.publish({ ...entry, state, position: at });
  }

  private readonly onPop = (): void => {
    const entry = this.read();
    const active = this.pending;
    if (active) {
      if (!active.replaying) this.restore(entry, active);
      else if (this.same(entry, active.destination)) {
        this.publish(entry);
        this.release(active);
      } else if (entry.position?.epoch === active.destination.position?.epoch) {
        this.target.history.go(active.destination.position!.index - entry.position!.index);
      } else {
        this.publish(this.indexed(active.destination, { epoch: crypto.randomUUID(), index: 0 }));
        this.release(active);
      }
      return;
    }
    if (!this.leave.isDirty()) {
      this.publish(
        this.comparable(entry)
          ? entry
          : this.indexed(entry, { epoch: crypto.randomUUID(), index: 0 }),
      );
      return;
    }
    const attempt: Attempt = {
      controller: new AbortController(),
      destination: entry,
      replaying: false,
      settled: [],
    };
    this.pending = attempt;
    this.restore(entry, attempt);
    void this.decide(attempt, () => {
      if (this.comparable(entry) && entry.position!.index !== this.accepted.position!.index) {
        attempt.replaying = true;
        const arrived = new Promise<void>((resolve) => attempt.settled.push(resolve));
        this.target.history.go(entry.position!.index - this.accepted.position!.index);
        return arrived;
      }
      this.publish(this.indexed(entry, { epoch: this.accepted.position!.epoch, index: 0 }));
    });
  };

  reset(): void {
    const attempt = this.pending;
    this.pending = undefined;
    if (attempt) {
      attempt.controller.abort();
      this.release(attempt);
    }
    this.accepted = this.indexed(this.read(), { epoch: crypto.randomUUID(), index: 0 });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    this.target.removeEventListener("popstate", this.onPop);
    guards.delete(this.target);
  }
}
