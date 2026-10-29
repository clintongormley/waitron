import type { DashboardPermissionContinuation } from "@waitron/dashboard-kit";
import type { SessionEpoch } from "./session-signals.js";

const RETURN_KEY = "waitron-permission-return";
const surfacePath = (path: unknown): path is string =>
  typeof path === "string" && path.startsWith("/manage/") && !/[?#]/.test(path);

export function preparePermissionReturn(path: string): void {
  try {
    sessionStorage.removeItem(RETURN_KEY);
    if (surfacePath(path)) sessionStorage.setItem(RETURN_KEY, JSON.stringify({ path }));
  } catch {
    // Returning to a surface is optional; authentication still uses its existing redirect.
  }
}

export function consumePermissionReturn(googleCallback: boolean): string | undefined {
  try {
    const saved = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    if (!googleCallback || saved === null) return undefined;
    const descriptor: unknown = JSON.parse(saved);
    return typeof descriptor === "object" &&
      descriptor !== null &&
      "path" in descriptor &&
      surfacePath(descriptor.path)
      ? descriptor.path
      : undefined;
  } catch {
    return undefined;
  }
}

type Snapshot = ReturnType<DashboardPermissionContinuation["snapshot"]>;
type Outcome = "signed-in" | "stopped";
interface Pending {
  signal: AbortSignal;
  abort: () => void;
  resolve: (outcome: Outcome) => void;
  started: boolean;
}

export class PermissionContinuation implements DashboardPermissionContinuation {
  #listeners = new Set<(snapshot: Snapshot) => void>();
  #pending?: Pending;
  #settlements = new Set<Promise<unknown>>();
  #needsReconciliation = false;
  #reconciling = false;
  #completed?: Pending;

  constructor(
    private readonly host: {
      epoch: () => SessionEpoch;
      identity: () => Omit<Snapshot, "accountGeneration">;
      prepare: () => Promise<boolean>;
      open: () => void;
      close: () => void;
      suspend: () => void;
      reconcile: (generation: number) => Promise<void>;
      changed: () => void;
    },
  ) {}

  get open(): boolean {
    return this.#pending?.started === true;
  }
  get unresolved(): boolean {
    return this.#needsReconciliation || this.#reconciling;
  }

  snapshot(): Snapshot {
    const identity = this.host.identity();
    return {
      accountGeneration: this.host.epoch().current(),
      authenticated: identity.authenticated,
      permissions: [...identity.permissions],
    };
  }
  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  notify(): void {
    for (const listener of this.#listeners) listener(this.snapshot());
    this.host.changed();
  }
  #advance(): void {
    this.host.epoch().advance();
    this.notify();
  }

  signIn({ signal }: { permission: string; signal: AbortSignal }): Promise<Outcome> {
    if (signal.aborted || this.#pending !== undefined || this.unresolved)
      return Promise.resolve("stopped");
    return new Promise<Outcome>((resolve) => {
      const pending: Pending = { signal, abort: () => this.stop(), resolve, started: false };
      this.#pending = pending;
      signal.addEventListener("abort", pending.abort, { once: true });
      void this.host.prepare().then(
        (allowed) => {
          if (this.#pending !== pending) return;
          if (!allowed || signal.aborted) {
            this.stop();
            return;
          }
          pending.started = true;
          this.#advance();
          this.host.open();
        },
        () => this.stop(),
      );
    });
  }

  trackAuthentication(settlement: Promise<unknown>): void {
    if (!this.open) return;
    this.#needsReconciliation = true;
    this.#settlements.add(settlement);
    this.host.suspend();
    this.notify();
    const settled = () => {
      this.#settlements.delete(settlement);
      if (!this.open) void this.readAgain();
    };
    void settlement.then(settled, settled);
  }

  complete(): void {
    const pending = this.#pending;
    if (pending === undefined) return;
    this.#pending = undefined;
    pending.signal.removeEventListener("abort", pending.abort);
    this.#completed = pending;
    this.#needsReconciliation = true;
    this.#advance();
    this.host.close();
    void this.readAgain();
  }

  stop(): void {
    const pending = this.#pending;
    if (pending === undefined) return;
    this.#pending = undefined;
    pending.signal.removeEventListener("abort", pending.abort);
    if (pending.started) {
      this.#advance();
      this.host.close();
    }
    pending.resolve("stopped");
    if (this.#needsReconciliation) void this.readAgain();
  }

  async readAgain(): Promise<void> {
    if (
      !this.#needsReconciliation ||
      this.#settlements.size !== 0 ||
      this.#reconciling ||
      this.open
    )
      return;
    this.#reconciling = true;
    const generation = this.host.epoch().current();
    try {
      await this.host.reconcile(generation);
      this.#needsReconciliation = false;
    } catch {
      // Only a fresh session read can restore access after a submitted authentication.
    } finally {
      this.#reconciling = false;
      const completed = this.#completed;
      this.#completed = undefined;
      completed?.resolve(this.snapshot().authenticated ? "signed-in" : "stopped");
      this.notify();
    }
  }

  reset(): void {
    this.#needsReconciliation = false;
    this.stop();
    this.#completed?.resolve("stopped");
    this.#completed = undefined;
    this.notify();
  }

  disconnect(): void {
    this.reset();
    this.#listeners.clear();
  }
}
