import type { DepartmentTransfer, TillApi } from "../api/client.js";
import { limited } from "./draft-sync.js";

export interface TransferSnapshot {
  incoming: DepartmentTransfer[];
  receivingAllowed: boolean | undefined;
  sent: DepartmentTransfer[];
  notifications: DepartmentTransfer[];
  error: unknown;
}
interface Options {
  api: TillApi;
  changed(): void;
  currentSource?(): string | undefined;
  onAccessLost?(code: string): void;
}
function empty(): TransferSnapshot {
  return {
    incoming: [],
    receivingAllowed: undefined,
    sent: [],
    notifications: [],
    error: undefined,
  };
}
function codeOf(error: unknown): string | undefined {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
function sessionLost(error: unknown): boolean {
  const code = codeOf(error);
  const status =
    error !== null && typeof error === "object" && "status" in error ? error.status : undefined;
  return (
    (code !== "department_transfer.not_allowed" && (status === 401 || status === 403)) ||
    code === "session.not_open" ||
    code === "session.required" ||
    code === "session.expired" ||
    code === "device.unauthorized" ||
    code === "device_profile.not_admitted" ||
    code === "person.suspended"
  );
}
function notificationKey(request: DepartmentTransfer): string {
  return `${request.id}:${request.status}:${request.revision}`;
}

export class DepartmentTransferMonitor {
  #snapshot = empty();
  #incomingError: unknown;
  #sourceError: unknown;
  #active?: AbortController;
  #poll?: ReturnType<typeof setInterval>;
  #retry?: ReturnType<typeof setTimeout>;
  #retryMs = 1000;
  #sourceTabId?: string;
  #wholeDepartment = false;
  #incomingFlight?: object;
  #sourceFlight?: object;
  #incomingDirty = false;
  #sourceDirty = false;
  #dismissed = new Set<string>();

  constructor(private readonly options: Options) {}

  get snapshot(): TransferSnapshot {
    return this.#snapshot;
  }
  get running(): boolean {
    return this.#active !== undefined;
  }

  start(): void {
    if (this.#active !== undefined) return;
    const active = new AbortController();
    this.#active = active;
    this.#retryMs = 1000;
    this.refresh();
    this.#connect(active);
    this.#poll = setInterval(() => this.refresh(), 15_000);
  }

  stop(): void {
    this.#active?.abort();
    this.#active = undefined;
    clearInterval(this.#poll);
    clearTimeout(this.#retry);
    this.#poll = undefined;
    this.#retry = undefined;
    this.#incomingFlight = undefined;
    this.#sourceFlight = undefined;
    this.#incomingDirty = false;
    this.#sourceDirty = false;
    this.#dismissed.clear();
    this.#sourceTabId = undefined;
    this.#wholeDepartment = false;
    this.#incomingError = undefined;
    this.#sourceError = undefined;
    this.#snapshot = empty();
    this.options.changed();
  }

  watchDepartment(): void {
    if (this.#wholeDepartment) return;
    this.#wholeDepartment = true;
    this.#sourceTabId = undefined;
    this.#resetSource();
  }

  #resetSource(): void {
    this.#sourceError = undefined;
    this.#sourceFlight = undefined;
    this.#sourceDirty = false;
    this.#update({ sent: [] });
    this.#readSource();
  }

  watchSource(tabId: string | undefined): void {
    if (!this.#wholeDepartment && tabId === this.#sourceTabId) return;
    this.#wholeDepartment = false;
    this.#sourceTabId = tabId;
    this.#resetSource();
  }

  dismiss(requestId: string): void {
    for (const request of this.#snapshot.notifications)
      if (request.id === requestId) this.#dismissed.add(notificationKey(request));
    this.#update({});
  }

  refresh(): void {
    void this.#readIncoming();
    this.#readSource();
  }

  #update(patch: Partial<TransferSnapshot>): void {
    const next = { ...this.#snapshot, ...patch, error: this.#incomingError ?? this.#sourceError };
    next.notifications = [
      ...next.incoming,
      ...next.sent.filter((row) => row.status !== "pending"),
    ].filter((row) => !this.#dismissed.has(notificationKey(row)));
    this.#snapshot = next;
    this.options.changed();
  }

  #loseAccess(code: string): void {
    this.stop();
    this.options.onAccessLost?.(code);
  }

  #connect(active: AbortController): void {
    void this.options.api
      .readDepartmentTransferEvents(
        (event) => {
          if (this.#active !== active) return;
          if (event === "ready") this.#retryMs = 1000;
          this.refresh();
        },
        { signal: active.signal },
      )
      .catch((error: unknown) => {
        if (this.#active !== active) return;
        const status =
          error !== null && typeof error === "object" && "status" in error
            ? error.status
            : undefined;
        const code = codeOf(error);
        if (code !== undefined && (status === undefined || status === 401 || status === 403))
          this.#loseAccess(code);
      })
      .finally(() => {
        if (this.#active !== active) return;
        this.#retry = setTimeout(() => {
          this.#retry = undefined;
          if (this.#active === active) this.#connect(active);
        }, this.#retryMs);
        this.#retryMs = Math.min(this.#retryMs * 2, 30_000);
      });
  }

  async #bounded<T>(
    active: AbortController,
    read: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const limit = limited(25_000, active.signal);
    let cancel = (): void => {};
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(new DOMException("Transfer read cancelled", "AbortError"));
      if (limit.signal.aborted) cancel();
      else limit.signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      return await Promise.race([read(limit.signal), cancelled]);
    } finally {
      limit.signal.removeEventListener("abort", cancel);
      limit.done();
    }
  }

  async #readIncoming(): Promise<void> {
    const active = this.#active;
    if (active === undefined) return;
    if (this.#incomingFlight !== undefined) {
      this.#incomingDirty = true;
      return;
    }
    const flight = {};
    this.#incomingFlight = flight;
    try {
      const answer = await this.#bounded(active, (signal) =>
        this.options.api.listIncomingDepartmentTransfers({ signal }),
      );
      if (this.#active !== active || this.#incomingFlight !== flight) return;
      this.#incomingError = undefined;
      this.#update({ incoming: answer.requests, receivingAllowed: true });
    } catch (error) {
      if (this.#active !== active || this.#incomingFlight !== flight) return;
      if (sessionLost(error)) this.#loseAccess(codeOf(error)!);
      else if (codeOf(error) === "department_transfer.not_allowed") {
        this.#incomingError = undefined;
        this.#update({ incoming: [], receivingAllowed: false });
      } else {
        this.#incomingError = error;
        this.#update({});
      }
    } finally {
      if (this.#active === active && this.#incomingFlight === flight) {
        this.#incomingFlight = undefined;
        if (this.#incomingDirty) {
          this.#incomingDirty = false;
          void this.#readIncoming();
        }
      }
    }
  }

  #readSource(): void {
    const active = this.#active;
    const wholeDepartment = this.#wholeDepartment;
    const tabId = wholeDepartment ? this.options.currentSource?.() : this.#sourceTabId;
    if (active === undefined || (!wholeDepartment && tabId === undefined)) return;
    if (this.#sourceFlight !== undefined) {
      this.#sourceDirty = true;
      return;
    }
    const flight = {};
    this.#sourceFlight = flight;
    void this.#bounded(active, async (signal) => {
      if (!wholeDepartment) return this.options.api.listSentDepartmentTransfers(tabId!, { signal });
      const department = await this.options.api.listDepartmentSentTransfers({ signal });
      if (tabId === undefined) return department;
      const selected = await this.options.api.listSentDepartmentTransfers(tabId, { signal });
      return {
        requests: [
          ...new Map(
            [...department.requests, ...selected.requests].map((row) => [row.id, row]),
          ).values(),
        ],
      };
    })
      .then((answer) => {
        if (this.#active === active && this.#sourceFlight === flight) {
          if (wholeDepartment && this.options.currentSource?.() !== tabId) {
            this.#sourceDirty = true;
            return;
          }
          this.#sourceError = undefined;
          this.#update({ sent: answer.requests });
        }
      })
      .catch((error: unknown) => {
        if (this.#active !== active || this.#sourceFlight !== flight) return;
        if (sessionLost(error)) this.#loseAccess(codeOf(error)!);
        else if (codeOf(error) === "department_transfer.not_allowed") {
          this.#sourceError = undefined;
          this.#update({ sent: [] });
        } else {
          this.#sourceError = error;
          this.#update({});
        }
      })
      .finally(() => {
        if (this.#active === active && this.#sourceFlight === flight) {
          this.#sourceFlight = undefined;
          if (this.#sourceDirty) {
            this.#sourceDirty = false;
            this.#readSource();
          }
        }
      });
  }
}
