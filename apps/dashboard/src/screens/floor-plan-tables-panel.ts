import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { createLabelComparator } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import { fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { PlanPlacement } from "../api/client.js";
import {
  patchTable,
  placeTable,
  joinedTableOf,
  madeOfText,
  sendChange,
  tableName,
  type DraftTable,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";
import type { FloorPlanDeleteAsk, FloorPlanNoRoom, FloorPlanSelect } from "./floor-plan-editor.js";

@customElement("floor-plan-tables-panel")
export class FloorPlanTablesPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        --columns: var(--wt-tap-min) minmax(0, 1.5fr) var(--wt-space-6) minmax(0, 1fr);
      }
      .title {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wt-space-2) var(--wt-space-4);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .marker {
        box-sizing: border-box;
        width: var(--wt-space-3);
        height: var(--wt-space-3);
        border-radius: 0;
      }
      .marker.placed {
        background: var(--wt-color-primary);
      }
      .marker.spare {
        background: transparent;
        border: 2px solid var(--wt-color-text-muted);
      }
      .marker.joined {
        background: var(--wt-color-text-muted);
      }
      .columns,
      .row {
        display: grid;
        grid-template-columns: var(--columns);
        align-items: center;
        column-gap: var(--wt-space-3);
      }
      .row {
        padding-inline: var(--wt-space-2);
      }
      .row .toggle {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .select {
        grid-column: 2 / -1;
        display: grid;
        grid-template-columns: subgrid;
        align-items: center;
        column-gap: var(--wt-space-3);
      }
      .columns {
        padding-inline: var(--wt-space-2);
      }
      .heads {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .columns span:first-child {
        grid-column: 2;
      }
      .heads wt-button {
        visibility: hidden;
        block-size: 0;
        overflow: hidden;
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .heads,
      li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        column-gap: var(--wt-space-2);
        border-radius: var(--wt-radius-md);
      }
      li[aria-current="true"] {
        background: var(--wt-color-surface-lifted);
      }
      li[aria-current="true"] .name {
        font-weight: var(--wt-font-weight-bold);
      }
      .toggle,
      .select {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-1) 0;
        border: 0;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .toggle:focus-visible,
      .select:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }
      [aria-disabled="true"] {
        cursor: default;
      }
      .name,
      .made-of {
        overflow-wrap: anywhere;
      }
      .made-of,
      .select[data-joined] .name,
      .select[data-joined] [data-seats] {
        color: var(--wt-color-text-muted);
      }
      .mark {
        grid-column: 1;
        margin: 0;
        padding: 0 var(--wt-space-2) var(--wt-space-2)
          calc(var(--wt-space-2) + 2 * var(--wt-space-3));
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .foot {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .foot wt-button {
        flex: 1 1 auto;
      }
    `,
  ];

  @property({ attribute: false }) draft!: FloorPlanDraft;
  @property({ attribute: false }) selected: string | null = null;
  /** A message to show under a table's name, by table key. */
  @property({ attribute: false }) marks: ReadonlyMap<string, string> = new Map();
  /** Where a spare table stood before it was taken off, by table key. */
  @property({ attribute: false }) places: ReadonlyMap<string, PlanPlacement> = new Map();
  /** Inside a `wt-sheet` the toggle names the list, so the panel drops its own heading. */
  @property({ type: Boolean }) inSheet = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #send<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
  }

  #press(table: DraftTable): void {
    if (joinedTableOf(this.draft, table.key) !== undefined) return;
    if (table.placement === null) {
      const next = placeTable(this.draft, table.key, this.places.get(table.key));
      if (next === this.draft) {
        this.#send<FloorPlanNoRoom>("floor-plan-no-room", { key: table.key });
        return;
      }
      sendChange(this, next);
      this.#send<FloorPlanSelect>("floor-plan-select", { key: table.key });
      return;
    }
    sendChange(this, patchTable(this.draft, table.key, { placement: null }));
    if (this.selected === table.key)
      this.#send<FloorPlanSelect>("floor-plan-select", { key: null });
  }

  #madeOf(table: DraftTable, joined: DraftTable | undefined): string {
    if (joined !== undefined)
      return fill("floor_plan_editor.in_named", { name: tableName(joined) });
    if (table.parts === null) return "—";
    const names = table.parts.flatMap((key) => {
      const part = this.draft.tables.find((t) => t.key === key);
      return part === undefined ? [] : [tableName(part)];
    });
    return names.length === 0 ? "—" : madeOfText(names);
  }

  #row(table: DraftTable, index: number) {
    const name = tableName(table);
    const placed = table.placement !== null;
    const mark = this.marks.get(table.key);
    const markId = `mark-${index}`;
    const joined = joinedTableOf(this.draft, table.key);
    const marker = joined !== undefined ? "joined" : placed ? "placed" : "spare";
    return html`<li
      data-table=${table.key}
      aria-current=${this.selected === table.key ? "true" : nothing}
    >
      <div class="row">
        <button
          type="button"
          class="toggle"
          data-action="toggle"
          aria-labelledby=${`name-${index}`}
          aria-pressed=${placed ? "true" : "false"}
          aria-disabled=${joined === undefined ? nothing : "true"}
          aria-describedby=${mark === undefined ? nothing : markId}
          @click=${() => this.#press(table)}
        >
          <span class="marker ${marker}" data-marker=${marker}></span>
        </button>
        <button
          id=${`name-${index}`}
          type="button"
          class="select"
          data-action="select"
          ?data-joined=${joined !== undefined}
          aria-disabled=${joined !== undefined ? "true" : nothing}
          aria-describedby=${mark === undefined ? nothing : markId}
          @click=${() => {
            if (placed && joined === undefined)
              this.#send<FloorPlanSelect>("floor-plan-select", { key: table.key });
          }}
        >
          <span class="name" data-name>${name}</span>
          <span
            ><span class="visually-hidden">${t("floor_plan_editor.seats")} </span
            ><span data-seats>${table.seats ?? "—"}</span></span
          >
          <span class="made-of" data-made-of>${this.#madeOf(table, joined)}</span>
        </button>
      </div>
      <wt-button
        variant="ghost"
        data-action="delete"
        aria-label=${fill("floor_plan_editor.delete_named", { name })}
        @click=${() => this.#send<FloorPlanDeleteAsk>("floor-plan-delete-ask", { key: table.key })}
        ><wt-icon name="bin"></wt-icon
      ></wt-button>
      ${mark === undefined ? nothing : html`<p class="mark" id=${markId} data-mark>${mark}</p>`}
    </li>`;
  }

  override render() {
    const compare = createLabelComparator();
    const tables = [...this.draft.tables].sort((a, b) => compare(tableName(a), tableName(b)));
    return html`
      <div class="foot">
        <wt-button
          variant="secondary"
          data-action="add-tables"
          @click=${() => this.#send("floor-plan-add-tables", {})}
          >${t("floor_plan_editor.add_tables")}</wt-button
        >
        <wt-button
          variant="secondary"
          data-action="add-joined-table"
          @click=${() => this.#send("floor-plan-add-joined-table", {})}
          >${t("floor_plan_editor.add_joined_table")}</wt-button
        >
      </div>
      <slot name="editor"></slot>
      <div class="title">
        ${this.inSheet ? nothing : html`<h2>${t("floor_plan_editor.tables")}</h2>`}
      </div>
      <div class="heads" aria-hidden="true">
        <span class="columns"
          ><span data-head>${t("floor_plan_editor.name")}</span
          ><span data-head>${t("floor_plan_editor.seats")}</span
          ><span data-head>${t("floor_plan_editor.made_of")}</span></span
        >
        <wt-button variant="ghost"><wt-icon name="bin"></wt-icon></wt-button>
      </div>
      <ul>
        ${tables.map((table, index) => this.#row(table, index))}
      </ul>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "floor-plan-tables-panel": FloorPlanTablesPanel;
  }
}
