import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import type { HourPeriod } from "../hours-types.js";
import { cellIntervals, tailOverlaps } from "../hours-rules.js";
import { t } from "./strings.js";

/** What one cell editor edits. `inherit` is offered only on a special date. */
export type CellMode = "inherit" | "closed" | "all_day" | "periods";
/** Periods stay in the draft while another mode is chosen, so choosing periods again restores them. */
export interface CellDraft {
  mode: CellMode;
  periods: HourPeriod[];
}

export function format(key: Parameters<typeof t>[0], values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    t(key),
  );
}

/** How a Closed, all-day or periods cell reads. */
export function cellText(cell: { mode: string; periods: readonly HourPeriod[] }): string {
  if (cell.mode === "closed") return t("hours.closed");
  if (cell.mode === "all_day") return t("hours.all_day");
  return cell.periods.map((period) => `${period.opensAt}–${period.closesAt}`).join(", ");
}

/** The cell's own faults, keyed by field name under `prefix`; a cell not in periods has none. */
export function cellChecks(prefix: string, cell: CellDraft): Record<string, string> {
  if (cell.mode !== "periods") return {};
  const errors: Record<string, string> = {};
  const complete: number[] = [];
  cell.periods.forEach((period, index) => {
    const at = `${prefix}.periods.${index}`;
    if (period.opensAt === "") errors[`${at}.opensAt`] = t("hours.time_required");
    if (period.closesAt === "") errors[`${at}.closesAt`] = t("hours.time_required");
    else if (period.closesAt === period.opensAt) errors[`${at}.closesAt`] = t("hours.same_time");
    if (!errors[`${at}.opensAt`] && !errors[`${at}.closesAt`]) complete.push(index);
  });
  const intervals = cellIntervals({
    mode: "periods",
    periods: complete.map((index) => cell.periods[index]!),
  })!;
  intervals.forEach((interval, at) => {
    if (intervals.slice(0, at).some((o) => interval.start < o.end && o.start < interval.end))
      errors[`${prefix}.periods.${complete[at]}.opensAt`] = t("hours.period_overlap");
  });
  return errors;
}

function intervalsOf(cell: CellDraft) {
  return cell.mode === "periods" && Object.keys(cellChecks("", cell)).length > 0
    ? []
    : cellIntervals(cell as Parameters<typeof cellIntervals>[0]);
}

/**
 * Where one day's hours run past midnight into the next day's, Saturday into Sunday included.
 * `week` is indexed by weekday, Sunday 0. The later day is marked, unless `only` names the one day
 * being edited, which is then marked whichever side of midnight it is on.
 */
export function weekChecks(
  week: readonly CellDraft[],
  prefixOf: (weekday: number) => string,
  only?: number,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const day = (weekday: number) => t(`hours.day_in_sentence.${weekday}` as Parameters<typeof t>[0]);
  for (let later = 0; later < 7; later++) {
    const earlier = (later + 6) % 7;
    if (only !== undefined && only !== earlier && only !== later) continue;
    if (!tailOverlaps(intervalsOf(week[earlier]!), intervalsOf(week[later]!))) continue;
    if (only === earlier)
      errors[`${prefixOf(earlier)}.mode`] = format("hours.overlap_next_day", { day: day(later) });
    else
      errors[`${prefixOf(later)}.mode`] = format("hours.overlap_previous_day", {
        day: day(earlier),
      });
  }
  return errors;
}

const MODE_LABEL: Record<Exclude<CellMode, "inherit">, Parameters<typeof t>[0]> = {
  closed: "hours.closed",
  all_day: "hours.all_day",
  periods: "hours.periods",
};

/** Edits one cell: Closed, Open all day or periods, and on a special date the standard hours. */
@customElement("hours-cell-editor")
export class HoursCellEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      fieldset {
        display: grid;
        gap: var(--wt-space-3);
        margin: 0;
        padding: 0;
        border: 0;
        min-width: 0;
      }
      legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }
      .period {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--wt-space-2);
      }
      .period wt-input {
        flex: 1 1 var(--wt-price-field-width);
      }
      .periods {
        display: grid;
        gap: var(--wt-space-2);
      }
    `,
  ];
  @property() label = "";
  /** Names every field, `${fieldPrefix}.mode` and `${fieldPrefix}.periods.N.opensAt`. */
  @property({ attribute: "field-prefix" }) fieldPrefix = "";
  @property({ attribute: false }) modes: CellMode[] = ["closed", "all_day", "periods"];
  @property({ attribute: false }) cell: CellDraft = { mode: "closed", periods: [] };
  /** The standard hours a blank choice keeps; empty while they are not known. */
  @property() inherited = "";
  @property({ attribute: false }) errors: Record<string, string> = {};
  @property({ type: Boolean, reflect: true }) disabled = false;

  #change(cell: CellDraft): void {
    this.dispatchEvent(
      new CustomEvent("hours-cell-change", { detail: { cell }, bubbles: true, composed: true }),
    );
  }

  #choose(value: string): void {
    const mode = (value === "" ? "inherit" : value) as CellMode;
    const periods =
      mode === "periods" && this.cell.periods.length === 0
        ? [{ id: crypto.randomUUID(), opensAt: "", closesAt: "" }]
        : this.cell.periods;
    this.#change({ mode, periods });
  }

  #setPeriod(index: number, key: "opensAt" | "closesAt", value: string): void {
    this.#change({
      ...this.cell,
      periods: this.cell.periods.map((period, at) =>
        at === index ? { ...period, [key]: value } : period,
      ),
    });
  }

  #error(name: string): string {
    return this.errors[`${this.fieldPrefix}.${name}`] ?? "";
  }

  #time(index: number, key: "opensAt" | "closesAt", period: HourPeriod) {
    return html`<wt-input
      type="time"
      required
      name=${`${this.fieldPrefix}.periods.${index}.${key}`}
      label=${t(key === "opensAt" ? "hours.opens" : "hours.closes")}
      .value=${period[key]}
      error=${this.#error(`periods.${index}.${key}`)}
      ?disabled=${this.disabled}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#setPeriod(index, key, event.detail.value);
      }}
    ></wt-input>`;
  }

  override render() {
    const inherit = this.inherited
      ? format("hours.inherit_value", { value: this.inherited })
      : t("hours.inherit");
    const options = this.modes.map((mode) => ({
      value: mode === "inherit" ? "" : mode,
      label: mode === "inherit" ? inherit : t(MODE_LABEL[mode]),
    }));
    const periods = this.cell.periods;
    return html`<fieldset>
      <legend>${this.label}</legend>
      <wt-combobox
        name=${`${this.fieldPrefix}.mode`}
        label=${t("hours.mode")}
        search="never"
        ?required=${!this.modes.includes("inherit")}
        .options=${options}
        .value=${this.cell.mode === "inherit" ? "" : this.cell.mode}
        placeholder=${this.modes.includes("inherit") ? inherit : ""}
        error=${this.#error("mode")}
        ?disabled=${this.disabled}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.#choose(event.detail.value);
        }}
      ></wt-combobox>
      ${
        this.cell.mode === "periods"
          ? html`<div class="periods">
              ${repeat(
                periods,
                (period) => period.id,
                (period, index) =>
                  html`<div class="period">
                    ${this.#time(index, "opensAt", period)} ${this.#time(index, "closesAt", period)}
                    <wt-button
                      variant="ghost"
                      data-test="remove-period"
                      aria-label=${format("hours.remove_period", { n: String(index + 1) })}
                      ?disabled=${this.disabled || periods.length === 1}
                      @click=${() =>
                        this.#change({
                          ...this.cell,
                          periods: periods.filter((_, at) => at !== index),
                        })}
                      >${t("hours.remove")}</wt-button
                    >
                  </div>`,
              )}
              <div>
                <wt-button
                  variant="secondary"
                  data-test="add-period"
                  ?disabled=${this.disabled}
                  @click=${() =>
                    this.#change({
                      ...this.cell,
                      periods: [...periods, { id: crypto.randomUUID(), opensAt: "", closesAt: "" }],
                    })}
                  >${t("hours.add_period")}</wt-button
                >
              </div>
            </div>`
          : nothing
      }
    </fieldset>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hours-cell-editor": HoursCellEditor;
  }
  interface HTMLElementEventMap {
    "hours-cell-change": CustomEvent<{ cell: CellDraft }>;
  }
}
