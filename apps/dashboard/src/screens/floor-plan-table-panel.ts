import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import "@waitron/ui/src/components/wt-switch.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { PlanPlacement } from "../api/client.js";
import {
  deleteTable,
  isAdoptable,
  patchTable,
  placeTable,
  removeJoin,
  type DraftTable,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";
import type {
  FloorPlanAddJoinAsk,
  FloorPlanChange,
  FloorPlanInvalid,
  FloorPlanSelect,
  FloorPlanTypedField,
} from "./floor-plan-editor.js";

const MAX_SEATS = 999;
const MIN_SIZE = 1;
const MAX_SIZE = 99;
const ROTATION_STEP = 15;
const TURN = 360;

const ROTATIONS = Array.from({ length: TURN / ROTATION_STEP }, (_, i) => {
  const degrees = String(i * ROTATION_STEP);
  return { value: degrees, label: `${degrees}°` };
});

function wholeIn(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n < min || n > max ? null : n;
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
  /** The page's mark for this table; `text` is a typed value it refused, shown in place of the
   *  draft's while the mark stands. */
  @property({ attribute: false }) fieldError: {
    field: string;
    message: string;
    text?: string;
  } | null = null;

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
    return this.fieldError?.field === field ? this.fieldError.message : "";
  }

  /** The refused text while the page's mark holds it, else the draft's value, re-applied over
   *  anything typed since. */
  #shown(field: FloorPlanTypedField, draftValue: number | null): ReturnType<typeof live> {
    const mark = this.fieldError;
    return live(
      mark?.field === field && mark.text !== undefined
        ? mark.text
        : draftValue === null
          ? ""
          : String(draftValue),
    );
  }

  #seats(value: string): void {
    const seats = value === "" ? null : wholeIn(value, 0, MAX_SEATS);
    if (value !== "" && seats === null) {
      this.#refuse("seats", value, () => t("floor_plan_editor.seats_invalid"));
      return;
    }
    this.#accept("seats");
    this.#patch({ seats }, `seats:${this.tableKey}`);
  }

  #placement(table: DraftTable, change: Partial<PlanPlacement>, mergeKey?: string): void {
    this.#patch({ placement: { ...table.placement!, ...change } }, mergeKey);
  }

  #size(table: DraftTable, field: "width" | "height", value: string): void {
    const size = wholeIn(value, MIN_SIZE, MAX_SIZE);
    if (size === null) {
      this.#refuse(field, value, () => t("floor_plan_editor.size_invalid"));
      return;
    }
    this.#accept(field);
    this.#placement(table, { [field]: size }, `${field}:${this.tableKey}`);
  }

  #shapesLocale: string | null = null;
  #shapeOptions: { value: string; label: string }[] = [];

  #shapes(): { value: string; label: string }[] {
    const locale = currentLocale();
    if (locale !== this.#shapesLocale) {
      this.#shapesLocale = locale;
      this.#shapeOptions = [
        { value: "rect", label: t("floor_plan_editor.rectangle") },
        { value: "round", label: t("floor_plan_editor.round") },
      ];
    }
    return this.#shapeOptions;
  }

  #delete(): void {
    this.#change(deleteTable(this.draft, this.tableKey));
    this.#send<FloorPlanSelect>("floor-plan-select", { key: null });
  }

  #label(key: string): string {
    const label = this.draft.tables.find((t) => t.key === key)?.label.trim() ?? "";
    return label || t("floor_plan_editor.unnamed");
  }

  /** Names go in last and through a function, so a name holding `{seats}` or `$&` stays as typed. */
  #joinText(tableKeys: string[], seats: number): string {
    const names = tableKeys
      .filter((key) => key !== this.tableKey)
      .map((key) => this.#label(key))
      .join(", ");
    return t("floor_plan_editor.join_with")
      .replace("{seats}", String(seats))
      .replace("{tables}", () => names);
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
                      @click=${() => this.#change(removeJoin(this.draft, join.key))}
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

  #placed(table: DraftTable) {
    const placement = table.placement!;
    return html`<wt-combobox
        name="shape"
        search="never"
        label=${t("floor_plan_editor.shape")}
        .options=${this.#shapes()}
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
        .value=${this.#shown("width", placement.width)}
        .error=${this.#error("width")}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#size(table, "width", value(e))}
      ></wt-number-stepper>
      <wt-number-stepper
        name="height"
        label=${t("floor_plan_editor.height")}
        .min=${MIN_SIZE}
        .max=${MAX_SIZE}
        .value=${this.#shown("height", placement.height)}
        .error=${this.#error("height")}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#size(table, "height", value(e))}
      ></wt-number-stepper>
      <wt-combobox
        name="rotation"
        search="never"
        label=${t("floor_plan_editor.rotation")}
        .options=${ROTATIONS}
        .value=${String(placement.rotation)}
        .error=${this.#error("rotation")}
        @wt-change=${(e: CustomEvent<{ value: string }>) =>
          this.#placement(table, { rotation: Number(value(e)) })}
      ></wt-combobox>`;
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
          .value=${this.#shown("seats", table.seats)}
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
      </div>
      ${this.#joins()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "floor-plan-table-panel": FloorPlanTablePanel;
  }
}
