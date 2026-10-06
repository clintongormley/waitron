import type { ReactiveController, ReactiveControllerHost } from "lit";
import { QueryController, type ResourceQuery } from "@waitron/dashboard-kit";
import type { DashboardApi, MenuReadPart, MenuReadResult, MenuReadRevision } from "./client.js";
import { dashboardQuery } from "./live-queries.js";

function covers(read: MenuReadResult, minimum: MenuReadRevision | undefined): boolean {
  const revision = read.revision;
  return (
    minimum !== undefined &&
    revision?.epoch === minimum.epoch &&
    Number.isSafeInteger(revision.sequence) &&
    revision.sequence >= minimum.sequence
  );
}

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
  #latest: Read | undefined;
  #fallback: ReturnType<typeof setTimeout> | undefined;
  #waiting: Array<{ after: number; minimum?: MenuReadRevision; done: () => void }> = [];

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
      this.#latest = { serial, result };
      this.#apply(result);
      this.#settle(serial, result);
    });
  }

  #settle(serial: number, result?: MenuReadResult): void {
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const waiter of waiting) {
      if (serial > waiter.after || (result !== undefined && covers(result, waiter.minimum)))
        waiter.done();
      else this.#waiting.push(waiter);
    }
    if (this.#waiting.length === 0) {
      clearTimeout(this.#fallback);
      this.#fallback = undefined;
    }
  }

  refresh(afterWrite = false): Promise<void> {
    const query = this.#query;
    if (query === undefined) return Promise.resolve();
    const minimum = afterWrite ? this.api().menuWriteRevision : undefined;
    if (this.#latest !== undefined && covers(this.#latest.result, minimum))
      return Promise.resolve();
    const data = this.api().liveData;
    if (data === undefined) return this.#watch(query).catch(() => undefined);
    const done = new Promise<void>((resolve) => {
      this.#waiting.push({ after: readSerial, minimum, done: resolve });
    });
    // Hold the explicit refresh briefly so a feed-triggered read can satisfy it.
    // An earlier read can satisfy it only with the server's completed-write revision.
    this.#fallback ??= setTimeout(() => {
      this.#fallback = undefined;
      if (this.#query === query) data.invalidate(query.dependencies);
    }, 100);
    return done;
  }

  release(): void {
    this.#queries.release("menu");
    this.#query = undefined;
    this.#latest = undefined;
    clearTimeout(this.#fallback);
    this.#fallback = undefined;
    for (const waiter of this.#waiting.splice(0)) waiter.done();
  }

  hostDisconnected(): void {
    this.release();
  }
}
