import type { ReactiveController, ReactiveControllerHost } from "lit";
import { QueryController, type ResourceQuery } from "@waitron/dashboard-kit";
import type { DashboardApi, MenuReadPart, MenuReadResult } from "./client.js";
import { dashboardQuery } from "./live-queries.js";

let readSerial = 0;
class ReadFailure {
  constructor(
    readonly serial: number,
    readonly error: unknown,
  ) {}
}

interface Read {
  serial: number;
  result: MenuReadResult;
}

export class MenuReadController implements ReactiveController {
  readonly #queries: QueryController;
  #query: ResourceQuery<Read> | undefined;
  #apply: (value: MenuReadResult) => void = () => {};
  #initial: Promise<void> = Promise.resolve();
  #started = 0;
  #fallback: ReturnType<typeof setTimeout> | undefined;
  #waiting: Array<{ after: number; done: () => void }> = [];

  constructor(
    host: ReactiveControllerHost,
    private readonly api: () => DashboardApi,
    error: (error: unknown) => void,
  ) {
    host.addController(this);
    this.#queries = new QueryController(
      host,
      () => this.api().liveData,
      (failure) => {
        error(failure instanceof ReadFailure ? failure.error : failure);
        this.#settle(failure instanceof ReadFailure ? failure.serial : this.#started);
      },
    );
  }

  watch(
    menuId: string,
    parts: readonly MenuReadPart[],
    apply: (value: MenuReadResult) => void,
    initialRead?: () => Promise<MenuReadResult>,
  ): Promise<void> {
    const api = this.api();
    const source = dashboardQuery(initialRead ? (api.background ?? api) : api, "getMenuRead", [
      menuId,
      parts,
    ]);
    const key = `${source.key}:coordinated`;
    this.#apply = apply;
    if (this.#query?.key === key) return this.#initial;
    this.release();
    let initial = initialRead;
    const query: ResourceQuery<Read> = {
      ...source,
      key,
      read: async () => {
        const serial = ++readSerial;
        if (this.#query === query) {
          this.#started = serial;
          clearTimeout(this.#fallback);
          this.#fallback = undefined;
        }
        try {
          const first = initial;
          initial = undefined;
          return { serial, result: await (first ? first() : source.read()) };
        } catch (error) {
          throw new ReadFailure(serial, error);
        }
      },
    };
    this.#query = query;
    this.#initial = this.#watch(query).catch((error: unknown) => {
      throw error instanceof ReadFailure ? error.error : error;
    });
    return this.#initial;
  }

  #watch(query: ResourceQuery<Read>): Promise<void> {
    return this.#queries.watch("menu", query, ({ serial, result }) => {
      this.#initial = Promise.resolve();
      this.#apply(result);
      this.#settle(serial);
    });
  }

  #settle(serial: number): void {
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const waiter of waiting) {
      if (serial > waiter.after) waiter.done();
      else this.#waiting.push(waiter);
    }
  }

  refresh(): Promise<void> {
    const query = this.#query;
    if (query === undefined) return Promise.resolve();
    const data = this.api().liveData;
    if (data === undefined) return this.#watch(query).catch(() => undefined);
    const done = new Promise<void>((resolve) => {
      this.#waiting.push({ after: readSerial, done: resolve });
    });
    // Hold the explicit refresh briefly so a feed-triggered read can satisfy it.
    // A read started before the save refresh cannot satisfy that request.
    this.#fallback ??= setTimeout(() => {
      this.#fallback = undefined;
      if (this.#query === query) data.invalidate(query.dependencies);
    }, 100);
    return done;
  }

  release(): void {
    this.#queries.release("menu");
    this.#query = undefined;
    clearTimeout(this.#fallback);
    this.#fallback = undefined;
    for (const waiter of this.#waiting.splice(0)) waiter.done();
  }

  hostDisconnected(): void {
    this.release();
  }
}
