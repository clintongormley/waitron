import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles, iconButtonStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import "@waitron/ui/src/components/wt-switch.js";
import { fill, t } from "../i18n/t.js";
import { wholeWithin } from "../widgets/form-fields.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { PlanPlacement } from "../api/client.js";
import {
  MAX_SEATS,
  patchTable,
  removeJoin,
  sendChange,
  tableName,
  type DraftTable,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";
import type {
  FloorPlanAddJoinAsk,
  FloorPlanInvalid,
  FloorPlanPanelError,
  FloorPlanTypedField,
} from "./floor-plan-editor.js";

const SHAPES = [
  { shape: "rect", icon: "table-rect", label: () => t("floor_plan_editor.rectangle") },
  { shape: "round", icon: "table-round", label: () => t("floor_plan_editor.round") },
] as const;

function value(event: CustomEvent<{ value: string }>): string {
  event.stopPropagation();
  return event.detail.value;
}

/** The selected table's fields and joins. Every value it draws comes from `draft`, so the page
 *  may re-create it when it crosses its narrow width. */
@customElement("floor-plan-table-panel")
export class FloorPlanTablePanel extends LitElement {
  static override styles = [
    baseStyles,
    iconButtonStyles,
    css`
      :host {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .pair {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--wt-space-3);
      }
      .shape {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
      .caption {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .shape-buttons {
        display: flex;
        gap: var(--wt-space-2);
      }
      .field-error {
        margin: 0;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      .joins {
        margin-top: var(--wt-space-4);
      }
      .joins h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .joins ul {
        margin: 0 0 var(--wt-space-2);
        padding: 0;
        list-style: none;
      }
      .joins li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        padding: var(--wt-space-1) 0;
      }
    `,
  ];

  @property({ attribute: false }) draft!: FloorPlanDraft;
  @property() tableKey = "";
  /** The page's marks for this table; a `text` is a typed value it refused, shown in place of the
   *  draft's while the mark stands. The first mark of a field is the one shown. */
  @property({ attribute: false }) fieldErrors: readonly FloorPlanPanelError[] = [];

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #send<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
  }

  #patch(patch: Parameters<typeof patchTable>[2], mergeKey?: string): void {
    sendChange(this, patchTable(this.draft, this.tableKey, patch), mergeKey);
  }

  /** A typed value the draft cannot hold goes to the page, which marks it and holds Save. */
  #refuse(field: FloorPlanTypedField, text: string, message: () => string): void {
    this.#send<FloorPlanInvalid>("floor-plan-invalid", {
      key: this.tableKey,
      field,
      text,
      message,
    });
  }

  #accept(field: FloorPlanTypedField): void {
    this.#send<FloorPlanInvalid>("floor-plan-invalid", { key: this.tableKey, field, text: null });
  }

  #error(field: string): string {
    return this.fieldErrors.find((e) => e.field === field)?.message ?? "";
  }

  /** The refused text while the page's mark holds it, else the draft's value, re-applied over
   *  anything typed since. */
  #shown(field: FloorPlanTypedField, draftValue: number | null): ReturnType<typeof live> {
    const mark = this.fieldErrors.find((e) => e.field === field);
    return live(
      mark?.text !== undefined ? mark.text : draftValue === null ? "" : String(draftValue),
    );
  }

  #seats(value: string): void {
    const seats = value === "" ? null : wholeWithin(value, 0, MAX_SEATS);
    if (value !== "" && seats === null) {
      this.#refuse("seats", value, () => t("floor_plan_editor.seats_invalid"));
      return;
    }
    this.#accept("seats");
    this.#patch({ seats }, `seats:${this.tableKey}`);
  }

  #shapeTo(table: DraftTable, shape: PlanPlacement["shape"]): void {
    if (table.placement!.shape === shape) return;
    this.#patch({ placement: { ...table.placement!, shape } });
  }

  #otherNames(tableKeys: string[]): string {
    return tableKeys
      .filter((key) => key !== this.tableKey)
      .map((key) => tableName(this.draft.tables.find((t) => t.key === key)))
      .join(", ");
  }

  #joinText(tableKeys: string[], seats: number): string {
    return fill("floor_plan_editor.join_with", {
      seats: String(seats),
      tables: this.#otherNames(tableKeys),
    });
  }

  #joins() {
    const joins = this.draft.joins.filter((j) => j.tableKeys.includes(this.tableKey));
    return html`<section class="joins" aria-labelledby="joins-heading">
      <h2 id="joins-heading" data-joins-heading>${t("floor_plan_editor.joins")}</h2>
      ${
        joins.length === 0
          ? nothing
          : html`<ul>
              ${joins.map(
                (join) =>
                  html`<li data-join=${join.key}>
                    <span data-join-text>${this.#joinText(join.tableKeys, join.seats)}</span
                    ><wt-button
                      variant="secondary"
                      data-test="remove-join"
                      aria-label=${`${t("action.remove")}: ${this.#otherNames(join.tableKeys)}`}
                      @click=${() => sendChange(this, removeJoin(this.draft, join.key))}
                      >${t("action.remove")}</wt-button
                    >
                  </li>`,
              )}
            </ul>`
      }
      <wt-button
        variant="secondary"
        data-test="add-join"
        @click=${() => this.#send<FloorPlanAddJoinAsk>("floor-plan-add-join", { tableKey: this.tableKey })}
        >${t("floor_plan_editor.add_join")}</wt-button
      >
    </section>`;
  }

  #shape(table: DraftTable) {
    const placement = table.placement!;
    const error = this.#error("shape");
    return html`<div class="shape">
      <span id="shape-caption" class="caption">${t("floor_plan_editor.shape")}</span>
      <!-- No tooltip: its Escape would also start leaving the editor; the caption names the pair. -->
      <div role="group" aria-labelledby="shape-caption" data-field="shape" class="shape-buttons">
        ${SHAPES.map(
          ({ shape, icon, label }) =>
            html`<button
              type="button"
              class="icon-button"
              data-shape=${shape}
              aria-label=${label()}
              aria-pressed=${String(placement.shape === shape)}
              aria-describedby=${error === "" ? nothing : "shape-error"}
              @click=${() => this.#shapeTo(table, shape)}
            >
              <wt-icon name=${icon}></wt-icon>
            </button>`,
        )}
      </div>
      ${error === "" ? nothing : html`<p id="shape-error" class="field-error" data-error="shape">${error}</p>`}
    </div>`;
  }

  override render() {
    const table = this.draft.tables.find((t) => t.key === this.tableKey);
    if (table === undefined) return nothing;
    const fixedError = this.#error("fixed");
    return html`<div class="fields">
        <wt-input
          name="table-name"
          required
          label=${t("floor_plan_editor.name")}
          .value=${table.label}
          .error=${this.#error("label")}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#patch({ label: value(e) }, `label:${this.tableKey}`)}
        ></wt-input>
        <div class="pair">
          <wt-number-stepper
            name="seats"
            clearable
            label=${t("floor_plan_editor.seats")}
            .min=${0}
            .max=${MAX_SEATS}
            .value=${this.#shown("seats", table.seats)}
            .error=${this.#error("seats")}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#seats(value(e))}
          ></wt-number-stepper>
          ${table.placement === null ? nothing : this.#shape(table)}
        </div>
        <wt-switch
          name="moveable"
          label=${t("floor_plan_editor.moveable")}
          .checked=${!table.fixed}
          .description=${fixedError}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
            e.stopPropagation();
            this.#patch({ fixed: !e.detail.checked });
          }}
        ></wt-switch>
        ${
          fixedError === ""
            ? nothing
            : html`<p class="field-error" data-error="fixed">${fixedError}</p>`
        }
      </div>
      ${this.#joins()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "floor-plan-table-panel": FloorPlanTablePanel;
  }
}
