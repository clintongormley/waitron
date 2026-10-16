import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles, iconButtonStyles, type ComboboxOption } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import "@waitron/ui/src/components/wt-switch.js";
import { t } from "../i18n/t.js";
import { wholeWithin } from "../widgets/form-fields.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import {
  MAX_SEATS,
  freeTables,
  patchTable,
  seatCount,
  sendChange,
  setParts,
  tableName,
  tablesChosen,
  type DraftTable,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";
import type {
  FloorPlanInvalid,
  FloorPlanPanelError,
  FloorPlanTypedField,
} from "./floor-plan-editor.js";

function value(event: CustomEvent<{ value: string }>): string {
  event.stopPropagation();
  return event.detail.value;
}

/** The selected table's fields. Every value it draws comes from `draft`, so the page
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
        display: grid;
        grid-template-columns: minmax(var(--wt-stepper-field-width), 0.9fr) minmax(0, 1fr) minmax(
            0,
            1.1fr
          );
        align-items: flex-start;
        gap: var(--wt-space-2);
      }
      .shape,
      .moveable {
        position: relative;
        display: flex;
        flex-direction: column;
        min-height: var(--wt-field-height);
        background: var(--wt-color-field-fill);
        border-start-start-radius: var(--wt-radius-md);
        border-start-end-radius: var(--wt-radius-md);
        box-shadow: inset 0 calc(-1 * var(--wt-field-line-width)) 0 var(--wt-color-field-line);
      }
      .moveable wt-switch {
        align-self: center;
        margin-block-start: var(--wt-space-3);
      }
      .caption {
        position: absolute;
        inset-inline: var(--wt-space-2);
        top: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        pointer-events: none;
      }
      .shape-buttons {
        display: grid;
      }
      .shape-buttons button {
        min-height: var(--wt-field-height);
        padding-block: calc(var(--wt-space-3) + var(--wt-font-size-sm)) var(--wt-space-2);
        border: 0;
        border-radius: 0;
        background: transparent;
      }
      .pair wt-number-stepper {
        min-width: 0;
      }
      .pair wt-number-stepper::part(field) {
        min-width: 0;
      }
      .field-error {
        margin: 0;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
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

  #seats(table: DraftTable, value: string): void {
    if (table.parts !== null && wholeWithin(value, 1, MAX_SEATS) === null) {
      this.#refuse("seats", value, () => t("floor_plan_editor.joined_seats_invalid"));
      return;
    }
    const seats = value === "" ? null : wholeWithin(value, 0, MAX_SEATS);
    if (value !== "" && seats === null) {
      this.#refuse("seats", value, () => t("floor_plan_editor.seats_invalid"));
      return;
    }
    this.#accept("seats");
    this.#patch({ seats }, `seats:${this.tableKey}`);
  }

  #shape(table: DraftTable) {
    const placement = table.placement!;
    const error = this.#error("shape");
    return html`<div class="shape">
      <span id="shape-caption" class="caption">${t("floor_plan_editor.shape")}</span>
      <div role="group" aria-labelledby="shape-caption" data-field="shape" class="shape-buttons">
        <button
          type="button"
          class="icon-button"
          data-shape=${placement.shape}
          aria-label=${t(placement.shape === "rect" ? "floor_plan_editor.rectangle" : "floor_plan_editor.round")}
          aria-describedby=${error === "" ? nothing : "shape-error"}
          @click=${() => this.#patch({ placement: { ...placement, shape: placement.shape === "rect" ? "round" : "rect" } })}
        >
          <wt-icon name=${placement.shape === "rect" ? "table-rect" : "table-round"}></wt-icon>
        </button>
      </div>
      ${error === "" ? nothing : html`<p id="shape-error" class="field-error" data-error="shape">${error}</p>`}
    </div>`;
  }

  #madeOf(table: DraftTable) {
    const options: ComboboxOption[] = freeTables(this.draft, table.key).map((part) => ({
      value: part.key,
      label: tableName(part),
      ...(part.seats === null ? {} : { description: seatCount(part.seats) }),
    }));
    return html`<wt-combobox
      multiple
      required
      name="made-of"
      search="never"
      label=${t("floor_plan_editor.made_of")}
      placeholder=${options.length === 0 ? t("floor_plan_editor.no_free_tables") : ""}
      .countLabel=${tablesChosen}
      .options=${options}
      .values=${[...table.parts!]}
      .error=${this.#error("parts")}
      @wt-change=${(e: CustomEvent<{ values: string[] }>) => {
        e.stopPropagation();
        sendChange(
          this,
          setParts(this.draft, this.tableKey, e.detail.values),
          `parts:${this.tableKey}`,
        );
      }}
    ></wt-combobox>`;
  }

  override render() {
    const table = this.draft.tables.find((t) => t.key === this.tableKey);
    if (table === undefined) return nothing;
    const fixedError = this.#error("fixed");
    const joined = table.parts !== null;
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
          ?required=${joined}
          ?clearable=${!joined}
          label=${t("floor_plan_editor.seats")}
          .min=${joined ? 1 : 0}
          .max=${MAX_SEATS}
          .value=${this.#shown("seats", table.seats)}
          .error=${this.#error("seats")}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#seats(table, value(e))}
        ></wt-number-stepper>
        ${table.placement === null ? nothing : this.#shape(table)}
        <div class="moveable">
          <span class="caption">${t("floor_plan_editor.moveable")}</span>
          <wt-switch
            name="moveable"
            hide-label
            label=${t("floor_plan_editor.moveable")}
            .checked=${!table.fixed}
            .description=${fixedError}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
              e.stopPropagation();
              this.#patch({ fixed: !e.detail.checked });
            }}
          ></wt-switch>
        </div>
      </div>
      ${joined ? this.#madeOf(table) : nothing}
      ${
        fixedError === ""
          ? nothing
          : html`<p class="field-error" data-error="fixed">${fixedError}</p>`
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "floor-plan-table-panel": FloorPlanTablePanel;
  }
}
