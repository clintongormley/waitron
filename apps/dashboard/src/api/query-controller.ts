import type { ReactiveControllerHost } from "lit";
import { QueryController } from "@waitron/dashboard-kit";
import type { DashboardApi } from "./client.js";
import { dashboardQuery, type DashboardQueryName } from "./live-queries.js";

/** Bind API query snapshots to a view's data fields. Editing drafts remain owned by the view. */
export class DashboardQueries {
  readonly #queries: QueryController;
  readonly #initialized = new Set<DashboardQueryName>();

  #client(name: DashboardQueryName): DashboardApi {
    const api = this.api();
    const client = this.#initialized.has(name) ? (api.background ?? api) : api;
    this.#initialized.add(name);
    return client;
  }

  constructor(
    host: ReactiveControllerHost,
    private readonly api: () => DashboardApi,
    error: (error: unknown) => void,
  ) {
    this.#queries = new QueryController(host, () => this.api().liveData, error);
  }

  release(name: DashboardQueryName): void {
    this.#queries.release(name);
  }

  watchGroup<N extends DashboardQueryName>(
    name: N,
    args: Parameters<DashboardApi[N]>[],
    apply: (values: Awaited<ReturnType<DashboardApi[N]>>[]) => void,
  ): Promise<void> {
    const api = this.#client(name);
    const queries = args.map((arg) => dashboardQuery(api, name, arg));
    return this.#queries.watch(
      name,
      {
        key: JSON.stringify([name, args]),
        dependencies: queries.flatMap((query) => query.dependencies),
        read: () => Promise.all(queries.map((query) => query.read())),
        refreshMs: 60_000,
      },
      apply,
    );
  }

  watch<N extends DashboardQueryName>(
    name: N,
    args: Parameters<DashboardApi[N]>,
    apply: (value: Awaited<ReturnType<DashboardApi[N]>>) => void | Promise<void>,
  ): Promise<void> {
    return this.#queries.watch(name, dashboardQuery(this.#client(name), name, args), apply);
  }
}
