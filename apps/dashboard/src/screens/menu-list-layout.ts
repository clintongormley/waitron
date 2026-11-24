import { css } from "lit";

export type ListLayout = "narrow" | "wide";

export const menuListStyles = css`
  h1 {
    margin: 0 0 var(--wt-space-4);
  }
  .header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-3);
    margin-bottom: var(--wt-space-4);
  }
  .header h1 {
    margin: 0;
  }
  .header wt-button {
    margin-inline-start: auto;
  }
  /* Back by the ghost button's own inline padding and border, so a name's text starts under
     the Name heading's text. The padding is narrowed so the button's border and focus ring
     stay inside the cell rather than on the table's clipped edge; it keeps its tap size. */
  wt-data-table::part(name) {
    --wt-button-padding-inline: var(--wt-space-1);
    overflow-wrap: anywhere;
    text-align: start;
    margin-inline-start: calc(-1 * (var(--wt-space-1) + 1px));
  }
  wt-data-table::part(muted) {
    color: var(--wt-color-text-muted);
  }
  .list,
  .sizer {
    container-type: inline-size;
  }
  .narrow-probe {
    display: none;
  }
  @container (max-width: 30rem) {
    .narrow-probe {
      display: block;
    }
  }
  @container (max-width: 52rem) {
    .with-usage .narrow-probe {
      display: block;
    }
  }
  wt-data-table::part(name-text) {
    text-align: start;
  }
  wt-data-table::part(stacked) {
    display: block;
  }
  /* The table itself never narrows a column below its content, so a long name wraps only
     within a width set here. On a narrow list the name and its status take the list's width
     less room for the row menu's column. */
  wt-data-table.narrow::part(name),
  wt-data-table.narrow::part(stacked) {
    max-width: calc(100cqi - 3 * var(--wt-tap-min));
  }
  /* Set by a container query on the list's width, like the probe's, rather than by the layout
     the probe chooses, so it already applies in the frame before the probe is read. The name
     leaves room for the row menu and for Status. */
  @container (width > 30rem) {
    wt-data-table::part(name) {
      max-width: calc(100cqi - 3 * var(--wt-tap-min) - var(--wt-menu-list-status-room));
    }
  }
`;

export class MenuListLayout {
  #listSize?: ResizeObserver;
  #probe?: Element;

  constructor(
    private readonly host: HTMLElement,
    private readonly apply: (layout: ListLayout) => void,
  ) {}

  /** The probe is observed rather than the list: its width follows the list's container, not the
   * table's contents. */
  measure(): ListLayout {
    const probe = this.#probe;
    return probe !== undefined && getComputedStyle(probe).display !== "none" ? "narrow" : "wide";
  }

  observe = (probe: Element | undefined): void => {
    if (this.#probe !== undefined) this.#listSize?.unobserve(this.#probe);
    this.#probe = probe;
    if (probe === undefined) return;
    this.#listSize ??= new ResizeObserver(() => {
      // Column changes wait until the searchable table's resize delivery has finished.
      requestAnimationFrame(() => {
        if (this.host.isConnected) this.apply(this.measure());
      });
    });
    this.#listSize.observe(probe);
  };
}
