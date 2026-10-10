import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import "@waitron/ui/src/components/wt-switch.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { PlanPlacement } from "../api/client.js";
import {
  deleteTable,
  isAdoptable,
  patchTable,
  placeTable,
  type DraftTable,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";
import type { FloorPlanChange, FloorPlanSelect } from "./floor-plan-editor.js";

const MAX_SEATS = 999;
const MIN_SIZE = 1;
const MAX_SIZE = 99;
const ROTATION_STEP = 15;
const TURN = 360;

type Typed = "seats" | "width" | "height";

function wholeIn(value: string, min: number, max: number): number | null {
  const n = Number(value);
  return value.trim() === "" || !Number.isInteger(n) || n < min || n > max ? null : n;
}

function value(event: CustomEvent<{ value: string }>): string {
  event.stopPropagation();
  return event.detail.value;
}

/** The selected table's fields and actions. Every value it draws comes from `draft`, so the page
 *  may re-create it when it crosses its narrow width. */
@customElement("floor-plan-table-panel")
export class FloorPlanTablePanel extends LitElement {
  static override styles = [
    baseStyles,
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
      .field-error {
        margin: 0;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) draft!: FloorPlanDraft;
  @property() tableKey = "";
  @property({ attribute: false }) fieldError: { field: string; message: string } | null = null;
  /** The page's join keys, for the joins this panel will add. */
  @property({ attribute: false }) nextJoinKey!: () => string;

  /** A typed value the draft cannot hold, refused beside its field without changing the draft. */
  @state() private invalid: { key: string; fields: Partial<Record<Typed, StringKey>> } | null =
    null;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #send<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
  }

  #change(draft: FloorPlanDraft, mergeKey?: string): void {
    this.#send<FloorPlanChange>("floor-plan-change", mergeKey ? { draft, mergeKey } : { draft });
  }

  #patch(patch: Parameters<typeof patchTable>[2], mergeKey?: string): void {
    this.#change(patchTable(this.draft, this.tableKey, patch), mergeKey);
  }

  #setInvalid(field: Typed, text: StringKey | null): void {
    const fields = this.invalid?.key === this.tableKey ? { ...this.invalid.fields } : {};
    if (text === null) delete fields[field];
    else fields[field] = text;
    this.invalid = { key: this.tableKey, fields };
  }

  #error(field: string): string {
    if (this.invalid?.key === this.tableKey) {
      const own = this.invalid.fields[field as Typed];
      if (own !== undefined) return t(own);
    }
    return this.fieldError?.field === field ? this.fieldError.message : "";
  }

  #seats(value: string): void {
    const seats = value.trim() === "" ? null : wholeIn(value, 0, MAX_SEATS);
    if (value.trim() !== "" && seats === null) {
      this.#setInvalid("seats", "floor_plan_editor.seats_invalid");
      return;
    }
    this.#setInvalid("seats", null);
    this.#patch({ seats }, `seats:${this.tableKey}`);
  }

  #placement(table: DraftTable, change: Partial<PlanPlacement>, mergeKey?: string): void {
    this.#patch({ placement: { ...table.placement!, ...change } }, mergeKey);
  }

  #size(table: DraftTable, field: "width" | "height", value: string): void {
    const size = wholeIn(value, MIN_SIZE, MAX_SIZE);
    if (size === null) {
      this.#setInvalid(field, "floor_plan_editor.size_invalid");
      return;
    }
    this.#setInvalid(field, null);
    this.#placement(table, { [field]: size }, `${field}:${this.tableKey}`);
  }

  #delete(): void {
    this.#change(deleteTable(this.draft, this.tableKey));
    this.#send<FloorPlanSelect>("floor-plan-select", { key: null });
  }

  #placed(table: DraftTable) {
    const placement = table.placement!;
    const rotations = Array.from({ length: TURN / ROTATION_STEP }, (_, i) => {
      const degrees = String(i * ROTATION_STEP);
      return { value: degrees, label: `${degrees}°` };
    });
    return html`<wt-combobox
        name="shape"
        search="never"
        label=${t("floor_plan_editor.shape")}
        .options=${[
          { value: "rect", label: t("floor_plan_editor.rectangle") },
          { value: "round", label: t("floor_plan_editor.round") },
        ]}
        .value=${placement.shape}
        .error=${this.#error("shape")}
        @wt-change=${(e: CustomEvent<{ value: string }>) =>
          this.#placement(table, { shape: value(e) === "round" ? "round" : "rect" })}
      ></wt-combobox>
      <wt-number-stepper
        name="width"
        label=${t("floor_plan_editor.width")}
        .min=${MIN_SIZE}
        .max=${MAX_SIZE}
        .value=${String(placement.width)}
        .error=${this.#error("width")}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#size(table, "width", value(e))}
      ></wt-number-stepper>
      <wt-number-stepper
        name="height"
        label=${t("floor_plan_editor.height")}
        .min=${MIN_SIZE}
        .max=${MAX_SIZE}
        .value=${String(placement.height)}
        .error=${this.#error("height")}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#size(table, "height", value(e))}
      ></wt-number-stepper>
      <wt-combobox
        name="rotation"
        search="never"
        label=${t("floor_plan_editor.rotation")}
        .options=${rotations}
        .value=${String(placement.rotation)}
        .error=${this.#error("rotation")}
        @wt-change=${(e: CustomEvent<{ value: string }>) =>
          this.#placement(table, { rotation: Number(value(e)) })}
      ></wt-combobox>`;
  }

  override willUpdate(): void {
    if (this.invalid !== null && this.invalid.key !== this.tableKey) this.invalid = null;
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
        <wt-number-stepper
          name="seats"
          clearable
          label=${t("floor_plan_editor.seats")}
          .min=${0}
          .max=${MAX_SEATS}
          .value=${table.seats === null ? "" : String(table.seats)}
          .error=${this.#error("seats")}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#seats(value(e))}
        ></wt-number-stepper>
        <wt-switch
          name="fixed"
          label=${t("floor_plan_editor.fixed_in_place")}
          .checked=${table.fixed}
          .description=${fixedError}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
            e.stopPropagation();
            this.#patch({ fixed: e.detail.checked });
          }}
        ></wt-switch>
        ${
          fixedError === ""
            ? nothing
            : html`<p class="field-error" data-error="fixed">${fixedError}</p>`
        }
        ${table.placement === null ? nothing : this.#placed(table)}
      </div>
      <div class="actions">
        ${
          table.placement === null
            ? html`<wt-button
                variant="secondary"
                data-test="place"
                @click=${() => this.#change(placeTable(this.draft, this.tableKey))}
                >${t("floor_plan_editor.place")}</wt-button
              >`
            : html`<wt-button
                variant="secondary"
                data-test="remove"
                @click=${() => this.#patch({ placement: null })}
                >${t("floor_plan_editor.remove_from_plan")}</wt-button
              >`
        }
        ${
          isAdoptable(table)
            ? nothing
            : html`<wt-button variant="danger" data-test="delete" @click=${() => this.#delete()}
                >${t("action.delete")}</wt-button
              >`
        }
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "floor-plan-table-panel": FloorPlanTablePanel;
  }
}
