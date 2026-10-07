import { compareLabels } from "@waitron/shared";
import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, visuallyHiddenStyles } from "../base-styles.js";
import { iconButtonStyles, trackIconTooltip } from "../icon-button.js";
import { holdPageCursor, releasePageCursor } from "../reorder-table.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-combobox.js";
import "./wt-button.js";
import "./wt-dialog.js";

registerIcons({
  "table-filter": "M1 2h14v1.5L10 9v5l-4 1.5V9L1 3.5z",
  "table-customise":
    "M1 2h11v1H2v3h9v1H2v3h6v1H1z M5 3h1v7H5z M12 9l.5 1 1-.2.6 1-.7.8.7.8-.6 1-1-.2-.5 1h-1l-.5-1-1 .2-.6-1 .7-.8-.7-.8.6-1 1 .2.5-1z M11.5 11a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0",
  "column-grip": "M5 2h2v2H5z M9 2h2v2H9z M5 7h2v2H5z M9 7h2v2H9z M5 12h2v2H5z M9 12h2v2H9z",
  "eye-open": "M1 8c2-3 4-4 7-4s5 1 7 4c-2 3-4 4-7 4S3 11 1 8zm7-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  "eye-closed":
    "M1 2l13 12 1-1L2 1z M2 8c.7-1 1.5-1.8 2.3-2.4l1.1 1.1A2.5 2.5 0 0 0 9.3 10l1.1 1.1c-.8.3-1.6.4-2.4.4-3 0-5-1-6-3.5z M8 4c3 0 5 1 7 4-.4.7-.9 1.3-1.5 1.8l-5.8-5.8z",
});

export interface DataTableColumn<Row> {
  key: string;
  label: string;
  group?: string;
  cell: (row: Row, context: { ancestorOnly: boolean }) => unknown;
  sortValue?: (row: Row) => string | number | null | undefined;
  searchValue?: (row: Row) => string;
  filter?: {
    label: string;
    allLabel: string;
    /** A list keeps the row when it holds a chosen option. */
    value: (row: Row) => string | readonly string[];
    options: { value: string; label: string }[];
    /** The option the filter starts on, while no choice is made or restored and the column's
     * options include it. Choosing the all option is then remembered as a choice of its own, so on
     * a table with a `viewKey` it outlives a reload. */
    initial?: string;
    /** Present, several options can be chosen at once and a row passes when it matches any of them.
     * `countLabel` is the closed dropdown's text once two or more are chosen. */
    multiple?: { countLabel: (count: number) => string };
  };
  align?: "start" | "end";
  /** Offers the column in the column chooser, shown or hidden until the person chooses. Absent, the
   * column is always shown. A hidden column still filters and is still searched, but does not sort. */
  choosable?: "shown" | "hidden";
  /** On the table's last column, keeps it at the box's trailing edge while the other columns scroll
   * sideways under it. */
  pinned?: "end";
  /** Keep the whole cell outside row activation, including blank space beside its action. */
  activatesRow?: false;
}

type SortDirection = "ascending" | "descending";

/** The tree's box width, in px, at or below which each level indents `--wt-space-2` rather than
 * `--wt-space-4` and stops deepening after four levels. */
const NARROW_TREE_WIDTH = 440;

/** A key function for `repeat`, which needs keys unique where `rowKey` may repeat one: rows that
 * share a key are told apart by which occurrence they are. */
function repeatKeys(keys: readonly string[]): (_item: unknown, index: number) => string {
  const seen = new Map<string, number>();
  const unique = keys.map((key) => {
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return `${occurrence}:${key}`;
  });
  return (_item, index) => unique[index]!;
}

/** The host width, in px, from which Filters opens its panel beside the rows rather than
 * over the whole screen: the panel is seven `--wt-tap-min` steps wide, so at this width and above
 * the rows beside it stay wider than NARROW_TREE_WIDTH at the default tokens. */
const SIDE_FILTERS_WIDTH = 768;

/** A filter's choice: one value for a single-choice filter, a list for a multi-select one. */
type FilterChoice = string | string[];

function isFilterChoice(value: unknown): value is FilterChoice {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every((each) => typeof each === "string"))
  );
}

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameChoices(a: Record<string, FilterChoice>, b: Record<string, FilterChoice>): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => {
      const [left, right] = [a[key]!, b[key]];
      if (typeof left === "string" || typeof right === "string") return left === right;
      return right !== undefined && sameValues(left, right);
    })
  );
}

interface ActiveFilter<Row> {
  value: (row: Row) => string | readonly string[];
  selected: readonly string[];
}

/** The host width, in px, at or below which the table's own search box takes a line of its own
 * under the toolbar's buttons: the Products list's catalogue browser moves its search at 40rem. */
const STACKED_SEARCH_WIDTH = 640;

@customElement("wt-data-table")
export class WtDataTable<Row = unknown> extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
      :host {
        display: block;
        min-width: 0;
      }

      .scroll {
        max-width: 100%;
        overflow-x: auto;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }

      :host([sticky-header]) {
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
      }

      /* A zero basis lets the box fill a bounded container and still report only its minimum to
         the containers above it, so below that minimum an outer container scrolls rather than the
         rows being squeezed. */
      :host([sticky-header]) .scroll {
        flex: 1 1 0;
        min-block-size: calc(var(--wt-tap-min) * 3);
      }

      :host([sticky-header]) thead th {
        position: sticky;
        inset-block-start: 0;
        z-index: 3;
        background: var(--wt-color-surface);
      }

      /* The collapsed border stays where the heading sits unscrolled, so the line under a held
         heading is drawn by the heading itself. */
      :host([sticky-header]) thead th::after {
        content: "";
        position: absolute;
        inset-inline: 0;
        inset-block-end: 0;
        border-block-end: 1px solid var(--wt-color-border);
      }

      .scroll:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      table {
        width: 100%;
        min-width: max-content;
        border-collapse: collapse;
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
      }

      table[data-locked-columns] {
        table-layout: fixed;
      }

      table[data-locked-columns] td {
        overflow-wrap: anywhere;
      }

      th,
      td {
        padding: var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
        text-align: start;
        vertical-align: baseline;
      }

      :host([top-aligned]) td {
        vertical-align: top;
      }

      th {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      th[data-filtered] {
        box-shadow: inset 0 calc(-1 * var(--wt-field-line-width-active)) 0 var(--wt-color-primary);
      }

      th[data-align="end"],
      td[data-align="end"] {
        text-align: end;
      }

      tbody tr:last-child td {
        border-bottom: 0;
      }

      tbody tr:hover {
        background: var(--wt-color-surface-raised);
      }

      /* Opaque, so the columns scrolling under it do not show through; above the lifted controls of
         a clickable row, which would otherwise paint over it as they pass. */
      [data-pinned="end"] {
        position: sticky;
        inset-inline-end: 0;
        z-index: 2;
        background: var(--wt-color-surface);
      }

      [data-actions][data-pinned="end"],
      [data-pinned="end"]:last-child {
        width: 0;
      }

      /* A collapsed border is drawn where the cell sits unscrolled, so the edge that must travel with
         it is drawn by the cell itself. */
      [data-pinned="end"]::before {
        content: "";
        position: absolute;
        inset-block: 0;
        inset-inline-start: 0;
        border-inline-start: 1px solid var(--wt-color-border);
      }

      tbody tr:hover td[data-pinned="end"] {
        background: var(--wt-color-surface-raised);
      }

      tr.clickable {
        position: relative;
      }

      /* The stretched activator covers the whole row so a mouse user can click anywhere; it is a
         real focusable button so keyboard/AT users tab to it and Enter/Space activate the row. It
         sits at the base layer… */
      .row-activate {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: pointer;
        z-index: 0;
      }

      .row-activate:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      /* …and the controls listed below sit ABOVE it in a clickable row, so a click on the
         Edit/Delete menu or the selection checkbox never activates the row. */
      tr.clickable
        td
        :is(button, a, input, select, label, wt-button, wt-row-actions, wt-relative-time):not(
          .row-activate
        ) {
        position: relative;
        z-index: 1;
      }

      tr.clickable td[data-row-activate="false"] {
        position: relative;
        z-index: 1;
        cursor: default;
      }

      .sort {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        padding: 0;
        border: 0;
        color: inherit;
        background: transparent;
        font: inherit;
        cursor: pointer;
      }

      .sort:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      .indicator {
        width: var(--wt-font-size-md);
        text-align: center;
      }

      th.select,
      td.select {
        width: var(--wt-tap-min);
        text-wrap: nowrap;
        text-align: center;
      }
      table[data-center-controls] td {
        vertical-align: middle;
      }
      table[data-center-controls] .tree-cell {
        align-items: center;
      }
      .row-controls {
        display: contents;
      }
      table[data-center-controls] .row-controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--wt-space-2);
      }

      .select input {
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        cursor: pointer;
        accent-color: var(--wt-color-primary);
      }

      .message {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      .error {
        color: var(--wt-color-danger);
      }

      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--wt-space-4);
        padding: var(--wt-space-6);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        text-align: center;
      }

      .table-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-3);
      }

      .table-search {
        flex: 1 1 calc(var(--wt-tap-min) * 8);
        min-width: 0;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-bg);
        color: var(--wt-color-text);
        font: inherit;
      }

      :host([stacked-search]) .table-search {
        order: 1;
        flex-basis: 100%;
      }

      /* Its primary border marks focus; an outer outline would draw a second line. */
      .table-search:focus-visible {
        border-color: var(--wt-color-primary);
        outline: none;
      }

      .table-filters {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .filters-clear-all,
      .filters-close {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }

      .filters-clear-all:focus-visible,
      .filters-close:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      .filters-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-space-5);
        min-height: var(--wt-space-5);
        margin-inline-start: var(--wt-space-2);
        padding-inline: var(--wt-space-1);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        font-size: var(--wt-font-size-sm);
      }

      .filters-panel {
        position: fixed;
        margin: 0;
        width: min(calc(var(--wt-tap-min) * 8), calc(100dvw - var(--wt-space-4)));
        max-height: calc(100dvh - 2 * var(--wt-space-2));
        overflow-y: auto;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }

      .filters-panel[data-fullscreen] {
        inset: 0;
        width: 100dvw;
        height: 100dvh;
        max-height: none;
        border-radius: 0;
      }

      .table-body {
        display: flex;
        align-items: flex-start;
        gap: var(--wt-space-3);
      }

      .table-body > :is(.scroll, .empty) {
        flex: 1 1 0;
        min-width: 0;
      }

      :host([sticky-header]) .table-body {
        flex: 1 1 0;
        align-items: stretch;
        min-block-size: calc(var(--wt-tap-min) * 3);
      }

      .filters-panel[data-side] {
        position: static;
        flex: none;
        width: calc(var(--wt-tap-min) * 7);
        max-height: none;
        box-shadow: none;
      }

      .filter-section {
        border-bottom: 1px solid var(--wt-color-border);
        padding-block: var(--wt-space-2);
      }

      .filter-section h3 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }

      .filters-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
      }

      .filters-panel h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }

      .table-end {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin-inline-start: auto;
      }

      .columns-trigger,
      .expand-all {
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }

      .columns-list {
        display: flex;
        flex-direction: column;
        max-height: calc(100dvh - 2 * var(--wt-space-6));
        overflow-y: auto;
      }

      .column-move-status {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }

      .column-choice {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding-inline: var(--wt-space-2);
        cursor: pointer;
      }

      .column-choice[data-fixed],
      .column-choice[data-unchoosable] {
        color: var(--wt-color-text-muted);
        cursor: default;
      }

      .column-choice[data-drop-target] {
        background: var(--wt-color-surface-lifted);
        outline: var(--wt-focus-ring);
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }

      .column-drag-preview {
        position: fixed;
        z-index: 1;
        pointer-events: none;
        transform: translate(-50%, -50%);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-lifted);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }

      [data-reorder],
      .handle-spacer {
        flex: none;
        width: var(--wt-tap-min);
      }

      [data-reorder] {
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-text);
        cursor: var(--reorder-drag-cursor, grab);
        touch-action: none;
      }

      [data-reorder]:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      .column-text {
        display: flex;
        flex: 1;
        flex-direction: column;
      }

      .column-note,
      .column-state {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .column-state {
        padding-inline: var(--wt-space-2);
        text-align: end;
      }

      .eye-toggle {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        cursor: pointer;
      }

      .eye-toggle input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
      }

      .eye-toggle wt-icon {
        color: var(--wt-color-primary);
      }

      .eye-toggle:has(input:disabled) {
        cursor: default;
      }

      .eye-toggle input:disabled + wt-icon {
        color: var(--wt-color-text-muted);
      }

      .columns-trigger:focus-visible,
      .expand-all:focus-visible,
      .eye-toggle input:focus-visible + wt-icon {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      /* A screen lines its own slots and headings up with this. At phone width the arrow takes a
         cell padding's width less, which a toggle button's tap target reaches back over (below). */
      :host {
        --tree-arrow-width: var(--wt-tap-min);
      }

      :host([narrow]) {
        --tree-arrow-width: calc(var(--wt-tap-min) - var(--wt-space-3));
      }

      .tree-toggle {
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font-size: var(--wt-font-size-xl);
        line-height: 1;
        cursor: pointer;
      }

      :host([narrow]) .tree-toggle {
        margin-inline-start: calc(var(--tree-arrow-width) - var(--wt-tap-min));
        padding-inline-start: calc(var(--wt-tap-min) - var(--tree-arrow-width));
      }

      .tree-toggle:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      /* A top-level toggle can sit against the scrolling box's edge, which clips an outward ring. */
      :host([narrow]) .tree-toggle:focus-visible {
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }

      .tree-spacer {
        display: inline-block;
        width: var(--tree-arrow-width);
      }

      .tree-arrow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--tree-arrow-width);
        height: var(--wt-tap-min);
        font-size: var(--wt-font-size-xl);
        line-height: 1;
      }

      /* The hover and focus rules are more specific than this resting band, so they still win over it. */
      tr.joined td {
        background: var(--wt-color-bg);
      }

      tbody tr.joined:hover td {
        background: var(--wt-color-surface-raised);
      }

      /* The raised surface equals the resting one in the light theme, so a row that opens something
         takes the lifted one. Last, and as specific as the pinned and joined rules, so it wins over
         both. */
      tbody tr.clickable:is(:hover, :focus-within) td {
        background: var(--wt-color-surface-lifted);
        cursor: pointer;
      }

      .tree-cell {
        display: inline-flex;
        align-items: baseline;
        padding-inline-start: calc(var(--tree-depth, 0) * var(--wt-space-4));
      }

      :host([narrow]) .tree-cell {
        padding-inline-start: calc(min(var(--tree-depth, 0), 4) * var(--wt-space-2));
      }
    `,
    iconButtonStyles,
  ];

  @property({ attribute: false }) rows: readonly Row[] = [];
  @property({ attribute: false }) columns: readonly DataTableColumn<Row>[] = [];
  @property({ attribute: false }) rowKey: (row: Row, index: number) => string = (_row, index) =>
    String(index);
  @property({ attribute: false }) rowParent?: (row: Row) => string | null;
  /** Siblings sort by this number first, smallest first in either sort direction, and by the chosen
   * column only within a group. Not applied to the children of a row `rowKeepsChildOrder` keeps in
   * order. */
  @property({ attribute: false }) rowGroup?: (row: Row) => number;
  /** In tree mode, a branch this returns false for is always open: it draws no toggle, is never seeded
   * closed, and `setExpanded` cannot close it. */
  @property({ attribute: false }) rowCollapsible: (row: Row) => boolean = () => true;
  /** In tree mode, a row this returns true for is drawn as part of its parent's row: at its parent's
   * indent rather than a level deeper, on the `--wt-color-bg` band, so a run of them reads as one
   * group under that row. Its `aria-level` still puts it a level down. */
  @property({ attribute: false }) rowJoinsParent: (row: Row) => boolean = () => false;
  /** In tree mode, the children of a row this returns true for are drawn in the order `rows` lists
   * them, ignoring `rowGroup` and the sort column, in either direction; their own children still
   * sort. */
  @property({ attribute: false }) rowKeepsChildOrder: (row: Row) => boolean = () => false;
  /** When set, each row becomes activatable, except on a flat table a row `rowClickable` refuses: a
   * stretched, focusable button covers the row and calls this on click. Per-row controls (the
   * selection checkbox, the Edit/Delete menu) sit above the activator, so they are never swallowed.
   * In a tree, `rowActivation` can give a row a toggle instead. */
  @property({ attribute: false }) rowClick?: (row: Row) => void;
  @property({ attribute: false }) rowClickLabel: (row: Row) => string = () => "Open row";
  /** On a flat table, a row this returns false for draws no activator and does not open from a
   * click on its pinned cell. Unset, every row clicks. A tree uses `rowActivation` instead. */
  @property({ attribute: false }) rowClickable?: (row: Row) => boolean;
  /** In tree mode, what a click or Enter anywhere on a row does: "toggle" opens and closes a branch,
   * "click" calls `rowClick`, "none" leaves the row to its own controls. Unset, every row clicks. */
  @property({ attribute: false }) rowActivation?: (row: Row) => "toggle" | "click" | "none";
  @property({ type: Boolean }) loading = false;
  @property() loadingMessage = "Loading";
  @property() emptyMessage = "No results";
  @property() errorMessage = "";
  @property() collapseLabel = "Collapse";
  @property() expandLabel = "Expand";
  /** Names each row's tree toggle, in place of `collapseLabel` and `expandLabel`, so a toggle can
   * say which branch it opens. */
  @property({ attribute: false }) rowToggleLabel?: (row: Row, expanded: boolean) => string;
  /** Extra part names for a row's tree toggle button, after `tree-toggle`, so a screen can style
   * one kind of row's toggle apart from another's. */
  @property({ attribute: false }) rowToggleParts?: (row: Row) => string;
  /** In tree mode, seed each branch as collapsed the first time that branch appears. A person can
   * still expand it normally, and later row refreshes do not collapse it again. */
  @property({ type: Boolean }) initiallyCollapsed = false;
  @property({ attribute: "aria-label" }) override ariaLabel = "";
  /** When set, a leading column of checkboxes (plus a select-all header box) lets the caller pick
   * rows. Selection is controlled: the caller passes `selected` and updates it on wt-selection-change.
   * Works in both flat and tree mode; rowSelectable can leave individual rows without a box. */
  @property({ type: Boolean }) selectable = false;
  @property({ attribute: false }) rowSelectable: (row: Row) => boolean = () => true;
  @property({ attribute: false }) selected: readonly string[] = [];
  @property({ attribute: false }) selectionLabel: (row: Row) => string = () => "Select row";
  @property() selectAllLabel = "Select all";
  @property({ attribute: false }) rowControls?: (row: Row) => unknown;
  @property() rowControlsLabel = "Row controls";
  @property() rowControlsAlign: "baseline" | "center" = "baseline";

  @property() sortKey: string | null = null;
  @property() sortDirection: SortDirection = "ascending";
  @property({ type: Boolean }) searchable = false;
  @property() searchLabel = "Search";
  /** Placeholder text for the search box; empty means it repeats `searchLabel`. */
  @property() searchPlaceholder = "";
  @property() noMatchesMessage = "Nothing matches your search or filters.";
  /** The placeholder of a column filter's search box, which a filter shows above seven rows, its all row included. */
  @property() filterSearchPlaceholder = "Search";
  /** What a column filter's open list says when its search matches no option. */
  @property() filterNoResultsLabel = "No results";
  @property() filtersLabel = "Filters";
  @property() filteredColumnLabel = "Filtered";
  @property() filtersClearAllLabel = "Clear all";
  @property() filtersCloseLabel = "Close filters";
  @property() customiseColumnsLabel = "Customise columns";
  @property() customiseLabel = "Customise";
  @property() restoreColumnsLabel = "Restore defaults";
  @property() doneLabel = "Done";
  @property() moveColumnLabel = "Move";
  @property() showColumnLabel = "Show";
  @property() hideColumnLabel = "Hide";
  @property() columnPositionLabel = "{position} of {total}";
  /** Stands in the Customise dialog where a column that cannot be hidden would have its eye. */
  @property() alwaysShownColumnLabel = "Always shown";
  /** Under the one shown column the person could otherwise hide, saying why its eye is refused. */
  @property() lastShownColumnLabel = "Keep at least one shown";
  /** The tab remembers sort and filter choices, and local storage remembers column visibility and
   * order under this key. Search text is never persisted. */
  @property() viewKey?: string;
  /** Narrows rows as a typed search would, for a table whose search box its consumer draws; ignored
   * while `searchable` draws the table's own. */
  @property() searchTerm = "";
  /** In tree mode, the toolbar's button that opens every branch; it reads `collapseAllLabel` while
   * every branch is open. Empty draws no button. */
  @property() expandAllLabel = "";
  @property() collapseAllLabel = "";
  /** The branches Expand all and Collapse all open, close and count as open; unset, every branch. */
  @property({ attribute: false }) expandAllIncludes?: (row: Row) => boolean;
  /** With `initiallyCollapsed` and a `viewKey`, the browser's local storage keeps the branches a
   * person opens, under `${viewKey}:expanded`, and opens them on the next visit. */
  @property({ type: Boolean }) rememberExpanded = false;
  /** In a tree, while a search is typed, holds open every row above a match, and keeps what passes
   * the filters under a match reachable. Off, only a row kept solely to place a match is held open. */
  @property({ type: Boolean }) searchOpensPath = false;
  /** Rows scroll inside the table's own box, under headings held at its top, while the toolbar
   * stays above it. The box fills the block size a bounded flex container gives the table, but is
   * never shorter than its minimum; given no such container, it is that minimum. */
  @property({ type: Boolean, reflect: true, attribute: "sticky-header" }) stickyHeader = false;
  /** Starts every body cell's content at the cell's top rather than lining cells up by their
   * first line's baseline. */
  @property({ type: Boolean, reflect: true, attribute: "top-aligned" }) topAligned = false;
  @state() private sideFilters = false;
  @state() private searchText = "";
  /** Every filter choice, chosen or restored, keyed by column key: a string for a single-choice
   * filter, a list for a multi-select one. An absent key means the column's `initial` option, or
   * "all" when it has none, and "" or [] is "all" chosen over an `initial` one. A choice filters
   * rows only while its column offers it (see #activeValues), and #judgeFilters removes what its
   * column's options no longer include. */
  @state() private filterSelections: Record<string, FilterChoice> = {};
  /** A filter must not let disappearing or returning rows resize the headings. */
  private filterColumnWidths: number[] | null = null;
  private filterHostWidth: number | null = null;
  #resizeFrame: number | null = null;
  @state() private filtersOpen = false;
  @query(".filters-trigger") private filtersTrigger!: HTMLButtonElement;
  @query(".filters-panel") private filtersPanel!: HTMLElement;
  @state() private collapsed = new Set<string>();
  /** Each column's shown state, chosen or restored; it applies only while its column is choosable. */
  @state() private columnChoices: Record<string, boolean> = {};
  @state() private columnOrder: string[] = [];
  @state() private columnMoveAnnouncement = "";
  @state() private columnDragPreview: {
    key: string;
    x: number;
    y: number;
    target: string | null;
  } | null = null;
  @state() private chooserOpen = false;
  @query(".columns-trigger") private chooserTrigger!: HTMLButtonElement;
  @query(".columns-panel") private chooserPanel!: HTMLElement;
  #columnDrag: { key: string; pointerId: number; startY: number; active: boolean } | null = null;
  private readonly seededBranches = new Set<string>();
  #restored = false;
  /** A CSS condition cannot read a token, so the width is compared here and the host carries the
   * answer as `narrow`. Setting it inside the callback would let rules keyed on `narrow` resize
   * the box this observer watches, which Chromium reports as a ResizeObserver loop. */
  readonly #scrollObserver = new ResizeObserver((entries) => {
    for (const { contentRect } of entries) this.#scrollWidth = contentRect.width;
    if (this.#narrowFrame !== null) return;
    this.#narrowFrame = requestAnimationFrame(() => {
      this.#narrowFrame = null;
      this.toggleAttribute("narrow", this.#scrollWidth <= NARROW_TREE_WIDTH);
    });
  });
  #scrollWidth = 0;
  #narrowFrame: number | null = null;
  /** Watched while column widths are held, a column has a filter or the table is searchable. Its
   * effects wait a frame: run inside the callback, they make Chromium report "ResizeObserver loop
   * completed with undelivered notifications". */
  readonly #hostObserver = new ResizeObserver(([entry]) => {
    this.#hostWidth = entry!.borderBoxSize[0]!.inlineSize;
    if (
      this.filterColumnWidths &&
      this.filterHostWidth !== null &&
      Math.abs(entry!.contentRect.width - this.filterHostWidth) > 0.5
    ) {
      this.#releaseColumnWidths();
      this.#widthsReleased = true;
    }
    if (this.#resizeFrame !== null) return;
    this.#resizeFrame = requestAnimationFrame(() => {
      this.#resizeFrame = null;
      if (!this.isConnected) return;
      this.sideFilters = this.#hostWidth >= SIDE_FILTERS_WIDTH;
      // A hidden table measures 0 wide and is not stacked, so it is not drawn stacked for a frame
      // when shown in a wide window.
      this.toggleAttribute(
        "stacked-search",
        this.searchable && this.#hostWidth > 0 && this.#hostWidth <= STACKED_SEARCH_WIDTH,
      );
      if (this.#widthsReleased) this.requestUpdate();
      this.#widthsReleased = false;
    });
  });
  #hostWidth = 0;
  #widthsReleased = false;
  #observedScroll: Element | null = null;
  /** Keeps a revealed or focused row clear of the headings held over the top of the box. */
  readonly #headObserver = new ResizeObserver(() => this.#padScroll());
  #observedHead: Element | null = null;
  #remembered: Set<string> | null = null;

  #rememberedOpen(): Set<string> {
    if (this.#remembered) return this.#remembered;
    let parsed: unknown = [];
    if (this.rememberExpanded && this.viewKey) {
      try {
        parsed = JSON.parse(localStorage.getItem(`${this.viewKey}:expanded`) ?? "[]");
      } catch {
        // Blocked or malformed storage reads as nothing remembered.
      }
    }
    this.#remembered = new Set(
      Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [],
    );
    return this.#remembered;
  }

  /** The indent follows the tree's own width, not the window's; a flat table is not watched. */
  #observeScroll(): void {
    const scroll = this.rowParent ? this.renderRoot.querySelector(".scroll") : null;
    if (!scroll) {
      this.#cancelNarrowFrame();
      this.removeAttribute("narrow");
    }
    if (!this.isConnected || scroll === this.#observedScroll) return;
    if (this.#observedScroll) this.#scrollObserver.unobserve(this.#observedScroll);
    if (scroll) this.#scrollObserver.observe(scroll);
    this.#observedScroll = scroll;
  }

  #cancelNarrowFrame(): void {
    if (this.#narrowFrame !== null) cancelAnimationFrame(this.#narrowFrame);
    this.#narrowFrame = null;
  }

  #padScroll(): void {
    const scroll = this.renderRoot.querySelector<HTMLElement>(".scroll");
    const head = this.stickyHeader ? this.renderRoot.querySelector("thead") : null;
    if (scroll)
      scroll.style.scrollPaddingBlockStart = head ? `${head.getBoundingClientRect().height}px` : "";
  }

  #observeHead(): void {
    const head = this.stickyHeader ? this.renderRoot.querySelector("thead") : null;
    if (head === this.#observedHead) return;
    this.#headObserver.disconnect();
    if (head) this.#headObserver.observe(head);
    this.#observedHead = head;
    this.#padScroll();
  }

  #hasFilters(): boolean {
    return this.columns.some((column) => column.filter);
  }

  #watchesHost(): boolean {
    return this.#hasFilters() || this.searchable;
  }

  #observeHost(): void {
    if (this.#watchesHost() || this.filterColumnWidths) this.#hostObserver.observe(this);
    else this.#hostObserver.disconnect();
  }

  /** Below the side width the panel is a full-screen popover, shown once it is rendered as one. */
  #placeFilters(): void {
    const panel = this.filtersPanel;
    if (!panel || !this.isConnected) return;
    panel.toggleAttribute("data-fullscreen", !this.sideFilters);
    if (this.filtersOpen && !this.sideFilters && !panel.matches(":popover-open"))
      panel.showPopover();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#observeHost();
    if (this.hasUpdated) {
      this.#observeScroll();
      this.#observeHead();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#endColumnDrag();
    // Removal hides an open popover without firing beforetoggle, so `placed` never records the close.
    if (!this.sideFilters) this.filtersOpen = false;
    this.#hostObserver.disconnect();
    if (this.#resizeFrame !== null) cancelAnimationFrame(this.#resizeFrame);
    this.#resizeFrame = null;
    this.#scrollObserver.disconnect();
    this.#cancelNarrowFrame();
    this.#observedScroll = null;
    this.#headObserver.disconnect();
    this.#observedHead = null;
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    this.#observeScroll();
    this.#observeHead();
    if (changed.has("searchable") && !this.searchable) this.removeAttribute("stacked-search");
    if (changed.has("columns") || changed.has("searchable")) this.#observeHost();
    if (changed.has("filtersOpen") || changed.has("sideFilters") || changed.has("columns"))
      this.#placeFilters();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("rows") || changed.has("columns") || changed.has("selectable"))
      this.#releaseColumnWidths();
    if (
      this.rows.length === 0 ||
      this.loading ||
      this.errorMessage !== "" ||
      !this.columns.some((column) => column.filter)
    )
      this.filtersOpen = false;
    if (!this.#offersChooser()) this.chooserOpen = false;
    if (changed.has("viewKey") || changed.has("rememberExpanded")) this.#remembered = null;
    if (
      this.initiallyCollapsed &&
      this.rowParent &&
      (changed.has("rows") || changed.has("rowParent") || changed.has("initiallyCollapsed"))
    ) {
      const byKey = this.#rowsByKey();
      const next = new Set(this.collapsed);
      let seeded = false;
      for (const row of this.rows) {
        const parent = this.rowParent(row);
        if (parent === null || !byKey.has(parent) || this.seededBranches.has(parent)) continue;
        this.seededBranches.add(parent);
        if (!this.rowCollapsible(byKey.get(parent)!)) continue;
        if (this.#rememberedOpen().has(parent)) continue;
        next.add(parent);
        seeded = true;
      }
      if (seeded) this.collapsed = next;
    }
    if (changed.has("viewKey")) this.#restored = false;
    if (!changed.has("viewKey") && !changed.has("columns")) return;
    this.#restoreView();
    if (this.#judgeFilters()) this.#persistView();
  }

  /** Reads the stored view once there are columns to check it against. A stored sort is adopted
   * only if a current column can sort by it, and its direction only together with that column.
   * Stored filter strings and lists of strings join filterSelections, to be judged like any other
   * choice. */
  #restoreView(): void {
    if (!this.viewKey || this.columns.length === 0) return;
    if (!this.#restored) {
      this.#restored = true;
      this.#restoreColumns(this.viewKey);
      let raw: string | null;
      try {
        raw = sessionStorage.getItem(this.viewKey);
      } catch {
        return; // storage blocked; defaults stand
      }
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as {
          sortKey?: unknown;
          sortDirection?: unknown;
          filters?: unknown;
        };
        if (
          typeof parsed.sortKey === "string" &&
          this.columns.some((c) => c.key === parsed.sortKey && c.sortValue !== undefined)
        ) {
          this.sortKey = parsed.sortKey;
          if (parsed.sortDirection === "ascending" || parsed.sortDirection === "descending")
            this.sortDirection = parsed.sortDirection;
        }
        if (parsed.filters && typeof parsed.filters === "object") {
          const stored = Object.entries(parsed.filters as Record<string, unknown>).filter(
            (entry): entry is [string, FilterChoice] => isFilterChoice(entry[1]),
          );
          this.filterSelections = { ...this.filterSelections, ...Object.fromEntries(stored) };
        }
      } catch {
        // A malformed store is ignored, exactly like a first visit.
      }
    }
  }

  /** Replaces the column choices with the ones stored under this key; anything unreadable is a
   * first visit. */
  #restoreColumns(viewKey: string): void {
    this.#releaseColumnWidths();
    let parsed: unknown;
    try {
      parsed = JSON.parse(localStorage.getItem(`${viewKey}:columns`) ?? "null");
    } catch {
      // Blocked or malformed storage reads as nothing stored.
    }
    // Object() makes an object of nothing read, null, a number, a string or a boolean, and none of
    // those has an own entry that is a boolean.
    const entries = Array.isArray(parsed) ? [] : Object.entries(Object(parsed) as object);
    this.columnChoices = Object.fromEntries(
      entries.filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    );
    try {
      const order: unknown = JSON.parse(localStorage.getItem(`${viewKey}:column-order`) ?? "null");
      this.columnOrder = Array.isArray(order)
        ? order.filter((key): key is string => typeof key === "string")
        : [];
    } catch {
      this.columnOrder = [];
    }
  }

  #orderedColumns(): DataTableColumn<Row>[] {
    const [first, ...rest] = this.columns;
    if (!first) return [];
    const movable = rest.filter((column) => column.pinned !== "end");
    const pinned = rest.filter((column) => column.pinned === "end");
    const byKey = new Map(movable.map((column) => [column.key, column]));
    const ordered = [...new Set(this.columnOrder)].filter((key) => byKey.has(key));
    for (const column of movable) {
      if (ordered.includes(column.key)) continue;
      const before = movable
        .slice(0, movable.indexOf(column))
        .reverse()
        .find((item) => ordered.includes(item.key));
      if (before) ordered.splice(ordered.indexOf(before.key) + 1, 0, column.key);
      else {
        const after = movable
          .slice(movable.indexOf(column) + 1)
          .filter((item) => ordered.includes(item.key))
          .sort((a, b) => ordered.indexOf(a.key) - ordered.indexOf(b.key))[0];
        if (after) ordered.splice(ordered.indexOf(after.key), 0, column.key);
        else ordered.push(column.key);
      }
    }
    return [first, ...ordered.map((key) => byKey.get(key)!), ...pinned];
  }

  /** The columns drawn, in the person's order; the first column stays shown. */
  #shownColumns(): DataTableColumn<Row>[] {
    const ordered = this.#orderedColumns();
    const shown = ordered.filter(
      (column, index) =>
        index === 0 ||
        column.pinned === "end" ||
        column.choosable === undefined ||
        (this.columnChoices[column.key] ?? column.choosable === "shown"),
    );
    if (shown.some((column) => column !== ordered[0] && column.pinned !== "end")) return shown;
    const firstMovable = ordered.find((column, index) => index > 0 && column.pinned !== "end");
    return firstMovable
      ? ordered.filter((column) => shown.includes(column) || column === firstMovable)
      : shown;
  }

  #moveColumn(key: string, delta: number): void {
    const focusedHandle = [
      ...this.renderRoot.querySelectorAll<HTMLButtonElement>("[data-reorder]"),
    ].find((handle) => handle.dataset.reorder === key && handle === this.shadowRoot?.activeElement);
    const movable = this.#orderedColumns().filter(
      (column, index) => index > 0 && column.pinned !== "end",
    );
    const from = movable.findIndex((column) => column.key === key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= movable.length) return;
    this.#releaseColumnWidths();
    const [moving] = movable.splice(from, 1);
    movable.splice(to, 0, moving!);
    this.columnOrder = movable.map((column) => column.key);
    if (focusedHandle) void this.updateComplete.then(() => focusedHandle.focus());
    this.columnMoveAnnouncement = `${moving!.label}, ${this.columnPositionLabel.replace("{position}", String(to + 2)).replace("{total}", String(this.columns.length))}`;
    if (this.viewKey) {
      try {
        localStorage.setItem(`${this.viewKey}:column-order`, JSON.stringify(this.columnOrder));
      } catch {
        // The table can be reordered without storage.
      }
    }
    this.dispatchEvent(
      new CustomEvent("wt-columns-change", {
        detail: { shown: this.#shownColumns().map((column) => column.key) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #startColumnDrag(event: PointerEvent, key: string): void {
    if (event.button !== 0 || this.#columnDrag) return;
    this.#columnDrag = { key, pointerId: event.pointerId, startY: event.clientY, active: false };
    document.addEventListener("pointermove", this.#moveColumnDrag);
    document.addEventListener("pointerup", this.#dropColumnDrag);
    document.addEventListener("pointercancel", this.#cancelColumnDrag);
  }

  readonly #moveColumnDrag = (event: PointerEvent): void => {
    const drag = this.#columnDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.abs(event.clientY - drag.startY) < 5) return;
    event.preventDefault();
    if (!drag.active) {
      drag.active = true;
      holdPageCursor();
    }
    const target = [...this.chooserPanel.querySelectorAll<HTMLElement>("[data-column-row]")].find(
      (row) => {
        const box = row.getBoundingClientRect();
        return (
          row.querySelector("[data-reorder]") &&
          event.clientX >= box.left &&
          event.clientX < box.right &&
          event.clientY >= box.top &&
          event.clientY < box.bottom
        );
      },
    );
    this.columnDragPreview = {
      key: drag.key,
      x: event.clientX,
      y: event.clientY,
      target: target?.dataset.columnRow ?? null,
    };
  };

  readonly #dropColumnDrag = (event: PointerEvent): void => {
    const drag = this.#columnDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.active) {
      const rows = [...this.chooserPanel.querySelectorAll<HTMLElement>("[data-column-row]")];
      const target = rows.find((row) => {
        const box = row.getBoundingClientRect();
        return (
          event.clientX >= box.left &&
          event.clientX < box.right &&
          event.clientY >= box.top &&
          event.clientY < box.bottom
        );
      });
      const destination = target?.dataset.columnRow;
      if (destination && target?.querySelector("[data-reorder]")) {
        const movable = this.#orderedColumns().filter(
          (column, index) => index > 0 && column.pinned !== "end",
        );
        const from = movable.findIndex((column) => column.key === drag.key);
        const to = movable.findIndex((column) => column.key === destination);
        if (from >= 0 && to >= 0) this.#moveColumn(drag.key, to - from);
      }
    }
    this.#endColumnDrag();
  };

  readonly #cancelColumnDrag = (event: PointerEvent): void => {
    if (event.pointerId === this.#columnDrag?.pointerId) this.#endColumnDrag();
  };

  #endColumnDrag(): void {
    if (this.#columnDrag?.active) releasePageCursor();
    this.#columnDrag = null;
    this.columnDragPreview = null;
    document.removeEventListener("pointermove", this.#moveColumnDrag);
    document.removeEventListener("pointerup", this.#dropColumnDrag);
    document.removeEventListener("pointercancel", this.#cancelColumnDrag);
  }

  #restoreColumnDefaults(): void {
    this.#releaseColumnWidths();
    this.columnChoices = {};
    this.columnOrder = [];
    this.columnMoveAnnouncement = "";
    if (this.viewKey) {
      try {
        localStorage.removeItem(`${this.viewKey}:columns`);
        localStorage.removeItem(`${this.viewKey}:column-order`);
      } catch {
        // Defaults still apply for this visit when storage is blocked.
      }
    }
    this.dispatchEvent(
      new CustomEvent("wt-columns-change", {
        detail: { shown: this.#shownColumns().map((column) => column.key) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #chooseColumn(key: string, shown: boolean): void {
    this.#releaseColumnWidths();
    this.columnChoices = { ...this.columnChoices, [key]: shown };
    if (this.viewKey) {
      try {
        localStorage.setItem(`${this.viewKey}:columns`, JSON.stringify(this.columnChoices));
      } catch {
        // The remembered columns are a convenience; the table works without them.
      }
    }
    this.dispatchEvent(
      new CustomEvent("wt-columns-change", {
        detail: { shown: this.#shownColumns().map((column) => column.key) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #toggleChooser(event: MouseEvent): void {
    event.preventDefault();
    if (this.chooserOpen) this.#closeChooser();
    else this.chooserOpen = true;
  }

  #closeChooser = (): void => {
    this.#endColumnDrag();
    this.chooserOpen = false;
  };

  #chooserKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented || !this.chooserOpen) return;
    event.preventDefault();
    event.stopPropagation();
    this.#closeChooser();
    this.chooserTrigger.focus();
  }

  /** The options a column's filter currently offers, or undefined while it offers none: the column
   * is absent, has no filter, or has an empty list (a consumer still loading the data behind it). */
  #offered(key: string): { value: string }[] | undefined {
    const options = this.columns.find((column) => column.key === key)?.filter?.options;
    return options && options.length > 0 ? options : undefined;
  }

  /** Removes every choice whose column offers options that do not include it, or whose shape (a
   * string or a list) is not its column's mode, and reports whether it changed any. A list loses
   * only the values its column's options do not include, and is removed when that leaves none. A
   * chosen "all" ("" or an empty list) is kept exactly while its column names an `initial`, and
   * removed otherwise. Any other choice whose column offers no options waits, kept and stored but
   * not applied, until the column offers a non-empty list to judge it by. */
  #judgeFilters(): boolean {
    const judged = Object.entries(this.filterSelections).flatMap(
      ([key, value]): [string, FilterChoice][] => {
        const filter = this.columns.find((column) => column.key === key)?.filter;
        if (filter && Array.isArray(value) !== Boolean(filter.multiple)) return [];
        const options = this.#offered(key);
        const offered = (choice: string) =>
          !options || options.some((option) => option.value === choice);
        // The all option is kept only where it overrides an initial choice; anywhere else it is
        // what an absent choice already means.
        if (value.length === 0) return filter?.initial !== undefined ? [[key, value]] : [];
        const kept = typeof value === "string" ? value : value.filter(offered);
        if (kept.length === 0) return [];
        return typeof kept === "string" && !offered(kept) ? [] : [[key, kept]];
      },
    );
    const next = Object.fromEntries(judged);
    if (sameChoices(next, this.filterSelections)) return false;
    this.filterSelections = next;
    return true;
  }

  /** The values that narrow rows for this column, none when there are none or they are waiting. An
   * initial choice applies only while nothing was chosen and the column offers it. */
  #activeValues(column: DataTableColumn<Row>): readonly string[] {
    const options = this.#offered(column.key);
    if (!options) return [];
    const chosen = this.filterSelections[column.key];
    if (chosen !== undefined) return typeof chosen === "string" ? (chosen ? [chosen] : []) : chosen;
    const initial = column.filter?.initial;
    return options.some((option) => option.value === initial) ? [initial!] : [];
  }

  #chooseFilter(column: DataTableColumn<Row>, values: readonly string[]): void {
    const stored = this.filterSelections[column.key];
    if (
      sameValues(values, this.#activeValues(column)) &&
      (values.length > 0 || stored === undefined || stored.length === 0)
    )
      return;
    const widths = this.filterColumnWidths ?? this.#currentColumnWidths();
    const next = { ...this.filterSelections };
    if (values.length === 0 && column.filter?.initial === undefined) delete next[column.key];
    else next[column.key] = column.filter?.multiple ? [...values] : (values[0] ?? "");
    this.filterSelections = next;
    this.filterColumnWidths = widths;
    if (widths) this.#hostObserver.observe(this);
    this.#persistView();
    this.dispatchEvent(
      new CustomEvent("wt-filter-change", {
        detail: { filters: { ...next } },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #clearAllFilters(): void {
    const widths = this.filterColumnWidths ?? this.#currentColumnWidths();
    const next = Object.fromEntries(
      this.columns
        .filter((column) => column.filter?.initial !== undefined)
        .map((column): [string, FilterChoice] => [column.key, column.filter?.multiple ? [] : ""]),
    );
    if (sameChoices(next, this.filterSelections)) return;
    this.filterSelections = next;
    this.filterColumnWidths = widths;
    if (widths) this.#hostObserver.observe(this);
    this.#persistView();
    this.dispatchEvent(
      new CustomEvent("wt-filter-change", {
        detail: { filters: { ...next } },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #currentColumnWidths(): number[] | null {
    const headers = this.shadowRoot?.querySelectorAll("thead th");
    if (headers?.length) this.filterHostWidth = this.getBoundingClientRect().width;
    return headers?.length
      ? [...headers].map((header) => header.getBoundingClientRect().width)
      : null;
  }

  #releaseColumnWidths(): void {
    this.filterColumnWidths = null;
    this.filterHostWidth = null;
    if (!this.#watchesHost()) this.#hostObserver.disconnect();
  }

  async #toggleFilters(event: MouseEvent): Promise<void> {
    event.preventDefault();
    if (this.filtersOpen) {
      this.#hideFilters();
      return;
    }
    this.sideFilters = this.getBoundingClientRect().width >= SIDE_FILTERS_WIDTH;
    this.filtersOpen = true;
    await this.updateComplete;
    if (this.filtersOpen) this.#focusFirstFilter();
  }

  /** Widths held for a choice made beside the rows would keep them at that narrower width. */
  #hideFilters(): void {
    if (this.filtersPanel.matches(":popover-open")) this.filtersPanel.hidePopover();
    if (this.sideFilters) this.#releaseColumnWidths();
    this.filtersOpen = false;
  }

  #focusFirstFilter(): void {
    this.filtersPanel
      .querySelector<HTMLElement>(".filter-section .table-filter")
      ?.shadowRoot?.querySelector<HTMLElement>(".trigger")
      ?.focus();
  }

  #persistView(): void {
    if (!this.viewKey) return;
    try {
      sessionStorage.setItem(
        this.viewKey,
        JSON.stringify({
          sortKey: this.sortKey,
          sortDirection: this.sortDirection,
          filters: this.filterSelections,
        }),
      );
    } catch {
      // The remembered view is a convenience; the table works without it.
    }
  }

  #emitSelection(next: string[]): void {
    const visible = this.#visibleRows();
    const keyedRows = this.rowParent
      ? this.#treeVisible(visible).rows
      : this.#sortedRows(visible, this.#sortColumn(this.#shownColumns()));
    const selectable = new Map(
      this.rows.map((row, index) => [this.rowKey(row, index), this.rowSelectable(row)]),
    );
    // Rendered keys take precedence: a caller can key flat rows by their sorted, filtered position.
    keyedRows.forEach((row, index) => {
      selectable.set(this.rowKey(row, index), this.rowSelectable(row));
    });
    this.dispatchEvent(
      new CustomEvent("wt-selection-change", {
        detail: { selected: next.filter((key) => selectable.get(key) !== false) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #toggleRow(key: string): void {
    this.#emitSelection(
      this.selected.includes(key)
        ? this.selected.filter((each) => each !== key)
        : [...this.selected, key],
    );
  }

  #toggleAll(visibleKeys: string[]): void {
    const allSelected =
      visibleKeys.length > 0 && visibleKeys.every((key) => this.selected.includes(key));
    this.#emitSelection(
      allSelected
        ? this.selected.filter((key) => !visibleKeys.includes(key))
        : [...this.selected, ...visibleKeys.filter((key) => !this.selected.includes(key))],
    );
  }

  #sort(column: DataTableColumn<Row>): void {
    if (column.sortValue === undefined) return;
    if (this.sortKey === column.key) {
      this.sortDirection = this.sortDirection === "ascending" ? "descending" : "ascending";
    } else {
      this.sortKey = column.key;
      this.sortDirection = "ascending";
    }
    this.dispatchEvent(
      new CustomEvent("wt-sort-change", {
        detail: { sortKey: this.sortKey, sortDirection: this.sortDirection },
        bubbles: true,
        composed: true,
      }),
    );
    this.#persistView();
  }

  /** Nulls sort last in either direction, and a tie keeps the incoming order. */
  #sortByColumn(
    rows: readonly Row[],
    column: DataTableColumn<Row> | undefined,
    indexOf: ReadonlyMap<Row, number>,
  ): Row[] {
    const group = this.rowGroup;
    if (column?.sortValue === undefined && group === undefined) return [...rows];
    const direction = this.sortDirection === "ascending" ? 1 : -1;
    return [...rows]
      .map((row) => ({
        row,
        index: indexOf.get(row)!,
        group: group?.(row) ?? 0,
        value: column?.sortValue?.(row),
      }))
      .sort((left, right) => {
        if (left.group !== right.group) return left.group - right.group;
        if (left.value == null && right.value == null) return left.index - right.index;
        if (left.value == null) return 1;
        if (right.value == null) return -1;
        const compared =
          typeof left.value === "number" && typeof right.value === "number"
            ? left.value - right.value
            : compareLabels(String(left.value), String(right.value));
        return compared === 0 ? left.index - right.index : compared * direction;
      })
      .map(({ row }) => row);
  }

  #searchHaystack(row: Row): string {
    return this.columns
      .map((column) =>
        column.searchValue
          ? column.searchValue(row)
          : column.sortValue
            ? String(column.sortValue(row) ?? "")
            : "",
      )
      .join(" ")
      .toLocaleLowerCase();
  }

  #term(): string {
    return (this.searchable ? this.searchText : this.searchTerm).trim().toLocaleLowerCase();
  }

  #passesSearch(row: Row): boolean {
    const term = this.#term();
    return term === "" || this.#searchHaystack(row).includes(term);
  }

  #activeFilters(): ActiveFilter<Row>[] {
    return this.columns.flatMap((column) => {
      const selected = this.#activeValues(column);
      return selected.length === 0 ? [] : [{ value: column.filter!.value, selected }];
    });
  }

  #passesFilters(row: Row, active: readonly ActiveFilter<Row>[]): boolean {
    return active.every(({ value, selected }) => {
      const held = value(row);
      return typeof held === "string"
        ? selected.includes(held)
        : held.some((each) => selected.includes(each));
    });
  }

  #visibleRows(): readonly Row[] {
    const active = this.#activeFilters();
    return this.rows.filter((row) => this.#passesFilters(row, active) && this.#passesSearch(row));
  }

  /** A hidden column sorts nothing, though `sortKey` still names it for when it is shown again. */
  #sortColumn(shown: readonly DataTableColumn<Row>[]): DataTableColumn<Row> | undefined {
    return shown.find((column) => column.key === this.sortKey && column.sortValue !== undefined);
  }

  #sortedRows(rows: readonly Row[], column: DataTableColumn<Row> | undefined): Row[] {
    const indexOf = new Map<Row, number>();
    rows.forEach((row, index) => indexOf.set(row, index));
    return this.#sortByColumn(rows, column, indexOf);
  }

  /** In tree mode a match's ancestors stay, so it is not shown as a false top-level row. With
   * `searchOpensPath` and a search typed, every ancestor is held open and what passes the filters
   * under a match stays reachable; otherwise only an ancestor kept solely for a match is held open. */
  #treeVisible(visible: readonly Row[]): {
    rows: readonly Row[];
    ancestorOnly: ReadonlySet<string>;
    heldOpen: ReadonlySet<string>;
  } {
    const parentOf = this.rowParent!;
    const keys = this.rows.map((row, index) => this.rowKey(row, index));
    const keyByRow = new Map<Row, string>();
    const rowByKey = new Map<string, Row>();
    this.rows.forEach((row, index) => {
      keyByRow.set(row, keys[index]!);
      if (!rowByKey.has(keys[index]!)) rowByKey.set(keys[index]!, row);
    });
    const matched = new Set(visible.map((row) => keyByRow.get(row)!));
    const ancestors = new Set<string>();
    this.rows.forEach((row, index) => {
      if (!matched.has(keys[index]!)) return;
      const visited = new Set<string>();
      let parentKey = parentOf(row);
      while (parentKey && !visited.has(parentKey)) {
        visited.add(parentKey);
        ancestors.add(parentKey);
        const parent = rowByKey.get(parentKey);
        parentKey = parent ? parentOf(parent) : null;
      }
    });
    const searching = this.searchOpensPath && this.#term() !== "";
    const below = new Set<string>();
    if (searching) {
      const active = this.#activeFilters();
      let grew = true;
      while (grew) {
        grew = false;
        this.rows.forEach((row, index) => {
          const key = keys[index]!;
          const parent = parentOf(row);
          if (matched.has(key) || below.has(key) || parent === null) return;
          if (!matched.has(parent) && !below.has(parent)) return;
          if (!this.#passesFilters(row, active)) return;
          below.add(key);
          grew = true;
        });
      }
    }
    const included = new Set([...matched, ...ancestors, ...below]);
    const ancestorOnly = new Set(
      [...ancestors].filter((key) => !matched.has(key) && !below.has(key)),
    );
    return {
      rows: this.rows.filter((_row, index) => included.has(keys[index]!)),
      ancestorOnly,
      heldOpen: searching ? ancestors : ancestorOnly,
    };
  }

  #treeRows(
    rows: readonly Row[],
    forcedOpen: ReadonlySet<string>,
    column: DataTableColumn<Row> | undefined,
  ): { row: Row; key: string; depth: number; hasChildren: boolean }[] {
    const keyOf = (row: Row, i: number) => this.rowKey(row, i);
    const parentOf = this.rowParent!;
    const indexOf = new Map<Row, number>();
    rows.forEach((r, i) => indexOf.set(r, i));
    const present = new Set(rows.map((r) => keyOf(r, indexOf.get(r)!)));
    // group children by parent key ("" = top level, including orphans whose parent is absent)
    const childrenByParent = new Map<string, Row[]>();
    for (const row of rows) {
      const p = parentOf(row);
      const bucket = p !== null && present.has(p) ? p : "";
      (childrenByParent.get(bucket) ?? childrenByParent.set(bucket, []).get(bucket)!).push(row);
    }
    const byKey = this.#rowsByKey();
    const out: { row: Row; key: string; depth: number; hasChildren: boolean }[] = [];
    const walk = (parentKey: string, depth: number) => {
      const children = childrenByParent.get(parentKey) ?? [];
      const parent = byKey.get(parentKey);
      const siblings =
        parent !== undefined && this.rowKeepsChildOrder(parent)
          ? children
          : this.#sortByColumn(children, column, indexOf);
      for (const row of siblings) {
        const key = keyOf(row, indexOf.get(row)!);
        const hasChildren = (childrenByParent.get(key) ?? []).length > 0;
        out.push({ row, key, depth, hasChildren });
        if (
          hasChildren &&
          (!this.collapsed.has(key) || forcedOpen.has(key) || !this.rowCollapsible(row))
        )
          walk(key, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }

  #rowsByKey(): Map<string, Row> {
    const byKey = new Map<string, Row>();
    this.rows.forEach((row, index) => {
      const key = this.rowKey(row, index);
      if (!byKey.has(key)) byKey.set(key, row);
    });
    return byKey;
  }

  #setOpen(keys: readonly string[], open: boolean): void {
    const next = new Set(this.collapsed);
    const remembered = this.#rememberedOpen();
    for (const key of keys) {
      if (open) {
        next.delete(key);
        remembered.add(key);
      } else {
        next.add(key);
        remembered.delete(key);
      }
    }
    this.collapsed = next;
    if (!this.rememberExpanded || !this.viewKey) return;
    try {
      localStorage.setItem(`${this.viewKey}:expanded`, JSON.stringify([...remembered]));
    } catch {
      // The remembered branches are a convenience; the table works without them.
    }
  }

  #toggle(key: string): void {
    const expanded = this.collapsed.has(key);
    this.#setOpen([key], expanded);
    this.dispatchEvent(
      new CustomEvent("wt-expand-change", {
        detail: { key, expanded },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Whether a branch shows its children; a key the table has never closed reads as open. */
  isExpanded(key: string): boolean {
    return !this.collapsed.has(key);
  }

  /** Opens or closes one branch as its toggle would, without reporting it as a person's change. */
  setExpanded(key: string, expanded: boolean): void {
    const row = this.#rowsByKey().get(key);
    if (!expanded && row !== undefined && !this.rowCollapsible(row)) return;
    this.#setOpen([key], expanded);
  }

  /** The order the table draws these rows in when they share a parent. */
  sortedSiblings(rows: readonly Row[]): Row[] {
    const parentKey = rows[0] === undefined ? null : (this.rowParent?.(rows[0]) ?? null);
    const parent = parentKey === null ? undefined : this.#rowsByKey().get(parentKey);
    if (parent !== undefined && this.rowKeepsChildOrder(parent)) {
      const position = new Map(this.rows.map((row, index) => [row, index]));
      return [...rows].sort((a, b) => (position.get(a) ?? -1) - (position.get(b) ?? -1));
    }
    return this.#sortedRows(rows, this.#sortColumn(this.#shownColumns()));
  }

  /** Opens every closed branch above the row with this key, then scrolls the row into view. */
  async revealRow(key: string): Promise<void> {
    const byKey = this.#rowsByKey();
    const closed: string[] = [];
    const seen = new Set<string>();
    const row = byKey.get(key);
    let parent = row !== undefined && this.rowParent ? this.rowParent(row) : null;
    while (parent !== null && byKey.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      if (this.collapsed.has(parent)) closed.push(parent);
      parent = this.rowParent!(byKey.get(parent)!);
    }
    if (closed.length > 0) this.#setOpen(closed, true);
    await this.updateComplete;
    this.#padScroll();
    const tr = this.shadowRoot!.querySelector(`tr[data-row-key="${CSS.escape(key)}"]`);
    if (!tr) return;
    tr.scrollIntoView({ block: "nearest" });
    const scroll = tr.closest<HTMLElement>(".scroll")!;
    // Chromium sets the scroll position to the nearest whole pixel (measured at a device pixel
    // ratio of 1), which can leave a row part of a pixel under the headings. A larger overlap is
    // a row taller than the view, which this leaves where scrollIntoView put it.
    const clear =
      scroll.getBoundingClientRect().top +
      scroll.clientTop +
      (parseFloat(scroll.style.scrollPaddingBlockStart) || 0);
    const under = clear - tr.getBoundingClientRect().top;
    if (under > 0 && under < 1) scroll.scrollTop = Math.floor(scroll.scrollTop - under);
  }

  /** A pinned cell is layered above the row's activator, so a click on its empty space reaches the
   * cell rather than the activator. Anything inside the cell may be a control of its own. */
  #openFromPinnedCell(event: Event, row: Row): void {
    if (event.target === event.currentTarget) this.rowClick!(row);
  }

  #selectionState(visibleKeys: string[]): { allSelected: boolean; someSelected: boolean } {
    const allSelected =
      visibleKeys.length > 0 && visibleKeys.every((key) => this.selected.includes(key));
    const someSelected = visibleKeys.some((key) => this.selected.includes(key));
    return { allSelected, someSelected };
  }

  /**
   * The header both rendering paths share. The `role=` attributes are the implicit roles of
   * `thead`, `tr` and `th`, so stating them costs nothing on the plain table and keeps the tree's
   * `role="treegrid"` complete — axe wants every level named once the table's own role is
   * overridden.
   */
  #renderHead(visibleKeys: string[], shown: readonly DataTableColumn<Row>[]) {
    const { allSelected, someSelected } = this.#selectionState(visibleKeys);
    const groups: { label: string; span: number }[] = [];
    for (const column of shown) {
      const previous = groups.at(-1);
      if (column.group && previous?.label === column.group) previous.span += 1;
      else groups.push({ label: column.group ?? "", span: 1 });
    }
    const hasGroups = groups.some((group) => group.label !== "");
    return html`
      <thead role="rowgroup">
        ${
          hasGroups
            ? html`<tr role="row" class="column-groups">
                ${this.selectable || this.rowControls ? html`<td aria-hidden="true"></td>` : nothing}
                ${groups.map((group) =>
                  group.label
                    ? html`<th role="columnheader" scope="colgroup" colspan=${group.span}>
                        ${group.label}
                      </th>`
                    : html`<td aria-hidden="true" colspan=${group.span}></td>`,
                )}
              </tr>`
            : nothing
        }
        <tr role="row">
          ${
            this.selectable || this.rowControls
              ? html`<th
                  scope="col"
                  role="columnheader"
                  class="select"
                  aria-label=${this.rowControls ? this.rowControlsLabel : nothing}
                >
                  ${this.rowControls ? html`<span class="visually-hidden">${this.rowControlsLabel}</span>` : nothing}
                  ${
                    this.selectable
                      ? html`<input
                          type="checkbox"
                          data-test="select-all"
                          aria-label=${this.selectAllLabel}
                          .checked=${allSelected}
                          .indeterminate=${someSelected && !allSelected}
                          @change=${(event: Event) => {
                            event.stopPropagation();
                            this.#toggleAll(visibleKeys);
                          }}
                        />`
                      : nothing
                  }
                </th>`
              : nothing
          }
          ${shown.map(
            (column, index) => html`
              <th
                role="columnheader"
                scope="col"
                data-align=${column.align ?? "start"}
                data-pinned=${column.pinned ?? nothing}
                data-actions=${column.key === "actions" ? "" : nothing}
                data-filtered=${column.filter && this.#activeValues(column).length > 0 ? "" : nothing}
                aria-label=${
                  column.filter && this.#activeValues(column).length > 0
                    ? `${column.label}: ${this.filteredColumnLabel}`
                    : nothing
                }
                aria-sort=${
                  column.sortValue === undefined
                    ? nothing
                    : this.sortKey === column.key
                      ? this.sortDirection
                      : "none"
                }
              >
                ${this.#treeHeading(
                  index,
                  column.sortValue === undefined
                    ? column.label
                    : html`<button
                        class="sort"
                        data-sort=${column.key}
                        @click=${(event: Event) => {
                          event.stopPropagation();
                          this.#sort(column);
                        }}
                      >
                        ${column.label}<span class="indicator" aria-hidden="true"
                          >${
                            this.sortKey === column.key
                              ? this.sortDirection === "ascending"
                                ? "▲"
                                : "▼"
                              : ""
                          }</span
                        >
                      </button>`,
                )}
              </th>
            `,
          )}
        </tr>
      </thead>
    `;
  }

  /** In a tree, the heading over the column that draws the tree, for a consumer to line up with
   * what its rows draw there. */
  #treeHeading(index: number, content: unknown) {
    return index === 0 && this.rowParent
      ? html`<span part="tree-heading">${content}</span>`
      : content;
  }

  /** The per-row checkbox cell both rendering paths share; `role="gridcell"` only in tree mode,
   * where the table's own role is overridden to `treegrid` and every cell needs one. */
  #renderSelectCell(key: string, row: Row, isTree: boolean) {
    if (!this.selectable && !this.rowControls) return nothing;
    return html`<td class="select" role=${isTree ? "gridcell" : nothing}>
      <span class="row-controls">
        ${
          this.selectable && this.rowSelectable(row)
            ? html`<input
                type="checkbox"
                data-test=${`select-${key}`}
                aria-label=${this.selectionLabel(row)}
                .checked=${this.selected.includes(key)}
                @change=${(event: Event) => {
                  event.stopPropagation();
                  this.#toggleRow(key);
                }}
              />`
            : nothing
        }
        ${this.rowControls?.(row) ?? nothing}
      </span>
    </td>`;
  }

  #branchKeys(): string[] {
    const byKey = this.#rowsByKey();
    const parents = new Set<string>();
    for (const row of this.rows) {
      const parent = this.rowParent!(row);
      if (parent === null || !byKey.has(parent)) continue;
      const branch = byKey.get(parent)!;
      if (this.rowCollapsible(branch) && (this.expandAllIncludes?.(branch) ?? true))
        parents.add(parent);
    }
    return [...parents];
  }

  #renderExpandAll() {
    if (!this.rowParent || this.expandAllLabel === "") return nothing;
    const branches = this.#branchKeys();
    const allOpen = branches.length > 0 && branches.every((key) => !this.collapsed.has(key));
    return html`<button
      type="button"
      class="expand-all"
      @click=${() => this.#setOpen(branches, !allOpen)}
    >
      ${allOpen ? this.collapseAllLabel : this.expandAllLabel}
    </button>`;
  }

  #renderToolbar() {
    const hasFilters = this.columns.some((column) => column.filter);
    const activeCount = this.columns.filter(
      (column) => column.filter && this.#activeValues(column).length > 0,
    ).length;
    const chooser = this.#offersChooser();
    const slotted = (name: string) => this.querySelector(`:scope > [slot="${name}"]`) !== null;
    const start = slotted("toolbar-start");
    const end = slotted("toolbar-end");
    const expandAll = this.#renderExpandAll();
    if (!this.searchable && !hasFilters && !chooser && !start && !end && expandAll === nothing)
      return nothing;
    return html`<div class="table-toolbar">
      ${hasFilters ? this.#renderFiltersTrigger(activeCount) : nothing}
      <slot name="toolbar-start"></slot>
      ${
        this.searchable
          ? html`<input
              class="table-search"
              type="search"
              name="search"
              autocomplete="off"
              aria-label=${this.searchLabel}
              placeholder=${this.searchPlaceholder || this.searchLabel}
              .value=${this.searchText}
              @input=${(event: Event) => {
                this.searchText = (event.target as HTMLInputElement).value;
              }}
            />`
          : nothing
      }
      ${
        expandAll !== nothing || end || chooser
          ? html`<div class="table-end">
              ${expandAll}<slot name="toolbar-end"></slot>${
                chooser ? this.#renderChooser() : nothing
              }
            </div>`
          : nothing
      }
    </div>`;
  }

  #renderFiltersTrigger(activeCount: number) {
    return html`<button
      type="button"
      class="filters-trigger icon-button"
      aria-label=${this.filtersLabel}
      aria-expanded=${this.filtersOpen}
      aria-controls="filters-panel"
      aria-describedby=${activeCount ? "filters-count" : nothing}
      popovertarget="filters-panel"
      @click=${this.#toggleFilters}
      @pointerenter=${trackIconTooltip}
      @pointerleave=${trackIconTooltip}
      @focus=${trackIconTooltip}
      @blur=${trackIconTooltip}
    >
      <wt-icon name="table-filter"></wt-icon>${
        activeCount
          ? html`<span class="filters-count" id="filters-count">${activeCount}</span>`
          : nothing
      }<span class="icon-tooltip" aria-hidden="true">${this.filtersLabel}</span>
    </button>`;
  }

  #filtersKeydown(event: KeyboardEvent): void {
    if (event.key === "Tab" && this.filtersPanel.hasAttribute("data-fullscreen")) {
      const first = this.filtersPanel.querySelector<HTMLButtonElement>(".filters-clear-all");
      const last = [
        ...this.filtersPanel.querySelectorAll<HTMLElement>(".filter-section .table-filter"),
      ]
        .at(-1)
        ?.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
      const origin = event.composedPath()[0];
      if (event.shiftKey && origin === first && last) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && origin === last && first) {
        event.preventDefault();
        first.focus();
      }
    }
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      !(this.filtersPanel.matches(":popover-open") || this.filtersOpen)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    this.#closeFilters();
  }

  #closeFilters(): void {
    this.#hideFilters();
    this.filtersTrigger.focus();
  }

  /** One panel serves both widths: in the flow beside the rows, or a
   * full-screen popover. Any close of the popover closes the filters; the close reported
   * when the panel stops being a popover is ignored, because the panel stays open beside the
   * rows. */
  #renderFiltersPanel() {
    const side = this.sideFilters;
    const placed = (event: ToggleEvent) => {
      if ((event.currentTarget as HTMLElement).hasAttribute("popover"))
        this.filtersOpen = event.newState === "open";
    };
    return html`<div
      id="filters-panel"
      class="filters-panel"
      popover=${side ? nothing : ""}
      ?hidden=${side && !this.filtersOpen}
      ?data-side=${side}
      role="group"
      aria-label=${this.filtersLabel}
      @beforetoggle=${placed}
      @keydown=${this.#filtersKeydown}
    >
      <h2>${this.filtersLabel}</h2>
      <div class="filters-panel-header">
        <button type="button" class="filters-clear-all" @click=${this.#clearAllFilters}>
          ${this.filtersClearAllLabel}
        </button>
        <button type="button" class="filters-close" @click=${this.#closeFilters}>
          ${this.filtersCloseLabel}
        </button>
      </div>
      <div class="table-filters">
        ${this.columns.map((column) => {
          const active = this.#activeValues(column);
          const multiple = column.filter?.multiple;
          return column.filter
            ? html`<div
                class="filter-section"
                data-section=${column.key}
                role="group"
                aria-label=${column.filter.label}
              >
                <h3>${column.filter.label}</h3>
                <wt-combobox
                  class="table-filter"
                  name=${`${column.key}-filter`}
                  data-filter=${column.key}
                  label=${column.filter.label}
                  hide-label
                  search="auto"
                  placeholder=${column.filter.allLabel}
                  show-empty-option
                  stable-width
                  searchPlaceholder=${this.filterSearchPlaceholder}
                  noResultsLabel=${this.filterNoResultsLabel}
                  ?multiple=${Boolean(multiple)}
                  .countLabel=${multiple?.countLabel ?? String}
                  .options=${[{ value: "", label: column.filter.allLabel }, ...column.filter.options]}
                  .value=${multiple ? "" : (active[0] ?? "")}
                  .values=${multiple ? [...active] : []}
                  @wt-change=${(event: CustomEvent<{ value?: string; values?: string[] }>) => {
                    event.stopPropagation();
                    const { value, values } = event.detail;
                    this.#chooseFilter(column, values ?? (value ? [value] : []));
                  }}
                ></wt-combobox>
              </div>`
            : nothing;
        })}
      </div>
    </div>`;
  }

  /** Every branch with rows to filter draws this one template, so a choice that empties the rows
   * or brings them back keeps the toolbar and the filters panel, and the focus inside them. */
  #withToolbar(content: unknown) {
    return html`${this.#renderToolbar()}<slot name="toolbar-bottom"></slot>${
        this.#hasFilters()
          ? html`<div class="table-body">${this.#renderFiltersPanel()}${content}</div>`
          : content
      }`;
  }

  /** Whether the chooser could change anything: a table opts in with a `choosable` column, and
   * there are two movable columns to reorder. One movable column can be neither moved nor hidden,
   * because the last shown movable column stays shown. */
  #offersChooser(): boolean {
    return (
      this.columns.some((column) => column.choosable !== undefined) &&
      this.columns.filter((column, index) => index > 0 && column.pinned !== "end").length >= 2
    );
  }

  #renderChooser() {
    const shown = this.#shownColumns();
    const visibleMovable = shown.filter(
      (column) => column !== this.columns[0] && column.pinned !== "end",
    );
    return html`<button
        type="button"
        class="columns-trigger"
        aria-expanded=${this.chooserOpen}
        aria-label=${this.customiseColumnsLabel}
        @click=${this.#toggleChooser}
        @keydown=${this.#chooserKeydown}
      >
        <wt-icon name="table-customise"></wt-icon>
      </button>
      <wt-dialog
        class="columns-panel"
        heading=${this.customiseLabel}
        .open=${this.chooserOpen}
        @wt-close=${this.#closeChooser}
        @keydown=${this.#chooserKeydown}
      >
        <div class="columns-list">
          ${repeat(
            this.#orderedColumns(),
            (column) => column.key,
            (column, index) => {
              const isShown = shown.includes(column);
              const fixed = index === 0 || column.pinned === "end";
              const alwaysShown = fixed || column.choosable === undefined;
              const lastShown = !alwaysShown && isShown && visibleMovable.length === 1;
              const note = `column-note-${column.key}`;
              return html`<div
                class="column-choice"
                data-column-row=${column.key}
                ?data-fixed=${fixed}
                ?data-unchoosable=${column.choosable === undefined}
                ?data-drop-target=${this.columnDragPreview?.target === column.key}
              >
                ${
                  fixed
                    ? html`<span class="handle-spacer" aria-hidden="true"></span>`
                    : html`<button
                        type="button"
                        data-reorder=${column.key}
                        aria-label=${`${this.moveColumnLabel} ${column.label}`}
                        @keydown=${(event: KeyboardEvent) => {
                          const delta =
                            event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                          if (!delta) return;
                          event.preventDefault();
                          event.stopPropagation();
                          this.#moveColumn(column.key, delta);
                        }}
                        @pointerdown=${(event: PointerEvent) => this.#startColumnDrag(event, column.key)}
                      >
                        <wt-icon name="column-grip"></wt-icon>
                      </button>`
                }
                <span class="column-text">
                  <span class="column-name">${column.label}</span>
                  ${
                    lastShown
                      ? html`<span class="column-note" id=${note}
                          >${this.lastShownColumnLabel}</span
                        >`
                      : nothing
                  }
                </span>
                ${
                  alwaysShown
                    ? html`<span class="column-state">${this.alwaysShownColumnLabel}</span>`
                    : html`<label class="eye-toggle">
                        <input
                          type="checkbox"
                          name=${`${column.key}-column`}
                          data-column=${column.key}
                          aria-label=${`${isShown ? this.hideColumnLabel : this.showColumnLabel} ${column.label}`}
                          aria-describedby=${lastShown ? note : nothing}
                          .checked=${isShown}
                          ?disabled=${lastShown}
                          @change=${(event: Event) => {
                            event.stopPropagation();
                            this.#chooseColumn(
                              column.key,
                              (event.target as HTMLInputElement).checked,
                            );
                          }} /><wt-icon name=${isShown ? "eye-open" : "eye-closed"}></wt-icon
                      ></label>`
                }
              </div>`;
            },
          )}
        </div>
        ${
          this.columnDragPreview
            ? html`<div
                class="column-drag-preview"
                aria-hidden="true"
                style=${`left: ${this.columnDragPreview.x}px; top: ${this.columnDragPreview.y}px`}
              >
                ${this.columns.find((column) => column.key === this.columnDragPreview?.key)?.label}
              </div>`
            : nothing
        }
        <div class="column-move-status" role="status" aria-live="polite">
          ${this.columnMoveAnnouncement}
        </div>
        <wt-button
          slot="footer"
          variant="secondary"
          data-restore-columns
          @click=${this.#restoreColumnDefaults}
        >
          ${this.restoreColumnsLabel}
        </wt-button>
        <wt-button slot="footer" @click=${this.#closeChooser}> ${this.doneLabel} </wt-button>
      </wt-dialog>`;
  }

  override render() {
    if (this.loading) return html`<p class="message" role="status">${this.loadingMessage}</p>`;
    if (this.errorMessage !== "")
      return html`<p class="message error" role="alert">${this.errorMessage}</p>`;
    const visible = this.#visibleRows();
    if (this.rows.length === 0)
      return html`<div class="empty">
        <p class="message" role="status">${this.emptyMessage}</p>
        <slot name="empty-action"></slot>
      </div>`;

    const label = this.ariaLabel || undefined;
    const isTree = this.rowParent !== undefined;
    // In tree mode kept ancestors keep a deep match on screen, so "no matches" counts the rows the
    // tree actually renders, not just the ones that matched.
    const treeVisible = isTree ? this.#treeVisible(visible) : undefined;
    const renderedCount = isTree ? treeVisible!.rows.length : visible.length;
    if (renderedCount === 0)
      return this.#withToolbar(
        html`<div class="empty">
          <p class="message" role="status">${this.noMatchesMessage}</p>
        </div>`,
      );

    const shown = this.#shownColumns();
    const widths =
      this.filterColumnWidths?.length ===
      shown.length + Number(this.selectable || this.rowControls !== undefined)
        ? this.filterColumnWidths
        : null;
    const lockedWidth = widths?.reduce((sum, width) => sum + width, 0);
    const sortColumn = this.#sortColumn(shown);
    if (!isTree) {
      const sorted = this.#sortedRows(visible, sortColumn);
      const rowKeys = sorted.map((row, index) => this.rowKey(row, index));
      const visibleKeys = sorted.flatMap((row, index) =>
        this.rowSelectable(row) ? [this.rowKey(row, index)] : [],
      );
      return this.#withToolbar(
        html`<div class="scroll" tabindex="0" role="region" aria-label=${label ?? nothing}>
          <table
            ?data-center-controls=${this.rowControls !== undefined && this.rowControlsAlign === "center"}
            data-locked-columns=${widths ? "" : nothing}
            style=${lockedWidth === undefined ? nothing : `width: ${lockedWidth}px`}
          >
            ${
              widths
                ? html`<colgroup>
                    ${widths.map((width) => html`<col style=${`width: ${width}px`} />`)}
                  </colgroup>`
                : nothing
            }
            ${this.#renderHead(visibleKeys, shown)}
            <tbody>
              ${repeat(sorted, repeatKeys(rowKeys), (row, index) => {
                const key = rowKeys[index]!;
                const clicks = this.rowClick !== undefined && (this.rowClickable?.(row) ?? true);
                return html`
                  <tr data-row-key=${key} class=${classMap({ clickable: clicks })}>
                    ${this.#renderSelectCell(key, row, false)}
                    ${shown.map(
                      (column, ci) => html`
                        <td
                          data-align=${column.align ?? "start"}
                          data-pinned=${column.pinned ?? nothing}
                          data-actions=${column.key === "actions" ? "" : nothing}
                          data-row-activate=${column.activatesRow === false ? "false" : nothing}
                          @click=${
                            column.pinned && column.activatesRow !== false && clicks
                              ? (event: Event) => this.#openFromPinnedCell(event, row)
                              : nothing
                          }
                        >
                          ${
                            ci === 0 && clicks
                              ? html`<button
                                    class="row-activate"
                                    aria-label=${this.rowClickLabel(row)}
                                    @click=${() => this.rowClick!(row)}
                                  ></button
                                  >${column.cell(row, { ancestorOnly: false })}`
                              : column.cell(row, { ancestorOnly: false })
                          }
                        </td>
                      `,
                    )}
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>`,
      );
    }

    const { rows: treeRows, ancestorOnly, heldOpen } = treeVisible!;
    const entries = this.#treeRows(treeRows, heldOpen, sortColumn);
    const visibleKeys = entries.filter(({ row }) => this.rowSelectable(row)).map(({ key }) => key);
    return this.#withToolbar(
      html`<div class="scroll" tabindex="0" role="region" aria-label=${label ?? nothing}>
        <table
          role="treegrid"
          ?data-center-controls=${this.rowControls !== undefined && this.rowControlsAlign === "center"}
          data-locked-columns=${widths ? "" : nothing}
          style=${lockedWidth === undefined ? nothing : `width: ${lockedWidth}px`}
        >
          ${
            widths
              ? html`<colgroup>
                  ${widths.map((width) => html`<col style=${`width: ${width}px`} />`)}
                </colgroup>`
              : nothing
          }
          ${this.#renderHead(visibleKeys, shown)}
          <tbody role="rowgroup">
            ${repeat(
              entries,
              repeatKeys(entries.map(({ key }) => key)),
              ({ row, key, depth, hasChildren }) => {
                const collapsible = this.rowCollapsible(row);
                const held = heldOpen.has(key);
                const expanded = !collapsible || !this.collapsed.has(key) || held;
                const cellContext = { ancestorOnly: ancestorOnly.has(key) };
                const branch = hasChildren && collapsible && !held;
                const mode = this.rowActivation?.(row) ?? "click";
                const toggles = mode === "toggle" && branch;
                const clicks = mode === "click" && this.rowClick !== undefined;
                const toggleLabel = this.rowToggleLabel
                  ? this.rowToggleLabel(row, expanded)
                  : expanded
                    ? this.collapseLabel
                    : this.expandLabel;
                const joined = depth > 0 && this.rowJoinsParent(row);
                const activate = toggles
                  ? () => this.#toggle(key)
                  : clicks
                    ? () => this.rowClick!(row)
                    : undefined;
                return html`<tr
                  data-row-key=${key}
                  role="row"
                  class=${classMap({ clickable: activate !== undefined, joined })}
                  aria-level=${depth + 1}
                  aria-expanded=${hasChildren ? String(expanded) : nothing}
                >
                  ${this.#renderSelectCell(key, row, true)}
                  ${shown.map(
                    (column, ci) =>
                      html`<td
                        role="gridcell"
                        data-align=${column.align ?? "start"}
                        data-pinned=${column.pinned ?? nothing}
                        data-actions=${column.key === "actions" ? "" : nothing}
                        data-row-activate=${column.activatesRow === false ? "false" : nothing}
                        @click=${
                          column.pinned && column.activatesRow !== false && activate !== undefined
                            ? (event: Event) => {
                                if (event.target === event.currentTarget) activate();
                              }
                            : nothing
                        }
                      >
                        ${
                          ci === 0
                            ? html`${
                                  toggles
                                    ? html`<button
                                        class="row-activate"
                                        aria-label=${toggleLabel}
                                        aria-expanded=${String(expanded)}
                                        @click=${(event: Event) => {
                                          event.stopPropagation();
                                          this.#toggle(key);
                                        }}
                                      ></button>`
                                    : clicks
                                      ? html`<button
                                          class="row-activate"
                                          aria-label=${this.rowClickLabel(row)}
                                          @click=${() => this.rowClick!(row)}
                                        ></button>`
                                      : nothing
                                }<span
                                  class="tree-cell"
                                  style=${`--tree-depth: ${joined ? depth - 1 : depth}`}
                                >
                                  ${
                                    !branch
                                      ? html`<span class="tree-spacer"></span>`
                                      : toggles
                                        ? html`<span class="tree-arrow" aria-hidden="true"
                                            >${expanded ? "▾" : "▸"}</span
                                          >`
                                        : html`<button
                                            class="tree-toggle"
                                            part=${`tree-toggle ${this.rowToggleParts?.(row) ?? ""}`.trim()}
                                            aria-label=${toggleLabel}
                                            @click=${(event: Event) => {
                                              event.stopPropagation();
                                              this.#toggle(key);
                                            }}
                                          >
                                            ${expanded ? "▾" : "▸"}
                                          </button>`
                                  }
                                  ${column.cell(row, cellContext)}
                                </span>`
                            : column.cell(row, cellContext)
                        }
                      </td>`,
                  )}
                </tr>`;
              },
            )}
          </tbody>
        </table>
      </div>`,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-data-table": WtDataTable;
  }
}
