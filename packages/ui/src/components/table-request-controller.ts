import type { ReactiveController, ReactiveControllerHost } from "lit";

/** The injected page read owns sorting; large datasets need SQL sorting or measurement first. */
export class TableRequestController<Q extends { search: string }> implements ReactiveController {
  page = 0;
  query?: Q;
  #key = "";
  #timer?: ReturnType<typeof setTimeout>;

  constructor(
    host: ReactiveControllerHost,
    private readonly watch: (query: Q, page: number) => Promise<void>,
  ) {
    host.addController(this);
  }

  setQuery(query: Q): void {
    const key = JSON.stringify(query);
    if (key === this.#key) return;
    const previous = this.query;
    this.query = query;
    this.#key = key;
    this.page = 0;
    clearTimeout(this.#timer);
    const { search: previousSearch, ...previousFilters } = previous ?? query;
    const { search, ...filters } = query;
    if (
      previous !== undefined &&
      previousSearch !== search &&
      JSON.stringify(previousFilters) === JSON.stringify(filters)
    )
      this.#timer = setTimeout(() => {
        void this.reload();
      }, 200);
    else void this.reload();
  }

  move(page: number): void {
    if (page === this.page) return;
    this.page = page;
    void this.reload();
  }

  async reload(): Promise<void> {
    clearTimeout(this.#timer);
    if (this.query !== undefined) await this.watch(this.query, this.page);
  }

  hostDisconnected(): void {
    clearTimeout(this.#timer);
  }
}
