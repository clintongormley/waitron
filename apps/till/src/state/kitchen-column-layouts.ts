import {
  type ColumnKey,
  type ColumnScope,
  type ColumnState,
  moveColumn,
  readColumnState,
  saveColumnState,
  setColumnVisible,
} from "./kitchen-columns.js";

/** Each board's layout, read from storage once and never again on a refresh. */
export class KitchenColumnLayouts {
  readonly #layouts = new Map<string, ColumnState>();

  constructor(
    readonly defaults: ColumnState,
    readonly storage: () => Storage | null = () => localStorage,
  ) {}

  /** The getter itself throws where the browser refuses storage altogether. */
  #storage(): Storage | null {
    try {
      return this.storage();
    } catch {
      return null;
    }
  }

  /** Without a scope a layout is held in memory only, apart for each board. */
  #key(scope: ColumnScope | null, board: string): string {
    return scope === null ? `memory|${board}` : JSON.stringify(scope);
  }

  get(scope: ColumnScope | null, board: string): ColumnState {
    const key = this.#key(scope, board);
    let layout = this.#layouts.get(key);
    if (layout === undefined) {
      const storage = scope === null ? null : this.#storage();
      layout =
        scope !== null && storage !== null
          ? readColumnState(storage, scope, this.defaults)
          : this.defaults;
      this.#layouts.set(key, layout);
    }
    return layout;
  }

  /** A refused store leaves the layout in memory. */
  keep(scope: ColumnScope | null, board: string, layout: ColumnState): void {
    this.#layouts.set(this.#key(scope, board), layout);
    const storage = scope === null ? null : this.#storage();
    if (scope !== null && storage !== null) saveColumnState(storage, scope, layout);
  }

  /** The Columns window's `column-move`. */
  applyMove(scope: ColumnScope | null, board: string, event: Event): void {
    const { key, direction } = (event as CustomEvent<{ key: ColumnKey; direction: "up" | "down" }>)
      .detail;
    this.keep(scope, board, moveColumn(this.get(scope, board), key, direction));
  }

  /** The Columns window's `column-show`. */
  applyShow(scope: ColumnScope | null, board: string, event: Event): void {
    const { key, visible } = (event as CustomEvent<{ key: ColumnKey; visible: boolean }>).detail;
    this.keep(scope, board, setColumnVisible(this.get(scope, board), key, visible));
  }
}
