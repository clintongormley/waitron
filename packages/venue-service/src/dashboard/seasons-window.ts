import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, type LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-colour-chooser.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { CalendarColour } from "../hours-types.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { MONTHS } from "./calendar-grid.js";
import { rememberedColourChoices, type ColourUser } from "./calendar-colours.js";
import { format, formatMonthDay, formatMonthName } from "./hours-view.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import {
  addRow,
  daysIn,
  draftOf,
  removeRow,
  runsUntil,
  sameDraft,
  type SeasonDraft,
  type SeasonRow,
} from "./season-draft.js";
import { seasonTintStyles } from "./season-tint.js";
import { t } from "./strings.js";

type RowField = "name" | "day" | "month" | "colour";

@customElement("seasons-window")
export class SeasonsWindow extends LitElement {
  static override styles = [
    baseStyles,
    seasonTintStyles,
    css`
      :host {
        display: block;
      }
      .table-wrap {
        overflow-x: auto;
      }
      .table-wrap:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: var(--wt-space-2) var(--wt-space-1);
        text-align: start;
        vertical-align: middle;
        border-bottom: 1px solid var(--wt-color-border);
      }
      th {
        white-space: nowrap;
        font-weight: var(--wt-font-weight-medium);
      }
      .required {
        color: var(--wt-color-danger);
        margin-inline-start: var(--wt-space-1);
      }
      .start {
        display: flex;
        gap: var(--wt-space-2);
      }
      .name wt-input {
        min-width: calc(var(--wt-space-8) * 4);
      }
      .start wt-combobox {
        min-width: calc(var(--wt-space-8) * 2);
      }
      .start wt-combobox[name$="-month"] {
        min-width: calc(var(--wt-space-8) * 3);
      }
      .until,
      .text {
        white-space: nowrap;
      }
      .bin {
        width: 1%;
        text-align: end;
      }
      .colour-text {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
        white-space: nowrap;
      }
      .swatch {
        display: inline-block;
        inline-size: var(--wt-space-4);
        block-size: var(--wt-space-4);
        border-radius: var(--wt-radius-sm);
        background: var(--season-tint);
        border: 1px solid var(--season-tint-line);
      }
      .below {
        display: grid;
        justify-items: start;
        gap: var(--wt-space-2);
        margin-block-start: var(--wt-space-3);
      }
      .hint {
        margin: 0;
        color: var(--wt-color-text-muted);
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
    `,
  ];
  @property({ attribute: false }) seasons: OpeningHoursModel["seasons"] = [];
  @property({ type: Number }) clockRevision = 0;
  @property({ attribute: false }) specialDays: readonly { id: string; name: string }[] = [];
  @property({ type: Boolean }) readOnly = false;
  @property({ attribute: false }) draftParent?: object;
  @property({ attribute: false }) api?: Pick<
    OpeningHoursApi,
    "saveSeasons" | "readSeasonDeleteImpact"
  >;
  @property({ attribute: false }) beforeClose?: (reason: LeaveReason) => Promise<boolean>;
  /** Replaced whole on every change, so a restore can swap it while keeping the live `next`. */
  @state() private draft?: SeasonDraft;
  private baseline?: SeasonDraft;
  private readonly colourChoices = new Map<string, ReturnType<typeof rememberedColourChoices>>();
  private users?: { draft: SeasonDraft; byKey: Map<string, readonly ColourUser[]> };

  override connectedCallback() {
    super.connectedCallback();
    this.dataset.test = "calendar-window";
    this.dataset.window = "seasons";
  }
  protected override willUpdate() {
    if (!this.draft) {
      this.baseline = draftOf(this.seasons);
      this.draft = this.baseline;
    }
  }
  private get rows(): readonly SeasonRow[] {
    return this.draft!.rows;
  }
  private change(key: string, field: RowField, value: string) {
    const draft = this.draft!;
    this.draft = {
      ...draft,
      rows: draft.rows.map((row) => {
        if (row.key !== key) return row;
        if (field === "colour") return { ...row, colour: value as CalendarColour };
        if (field !== "month") return { ...row, [field]: value };
        const day = row.day && Number(row.day) > daysIn(value) ? String(daysIn(value)) : row.day;
        return { ...row, day, month: value };
      }),
    };
  }
  /** The other named rows, by key, kept while the draft is unchanged so the chooser keeps its choices. */
  private usersOf(key: string): readonly ColourUser[] {
    const draft = this.draft!;
    if (this.users?.draft !== draft) {
      const named = draft.rows.filter((row) => row.name.trim() !== "");
      this.users = {
        draft,
        byKey: new Map(
          draft.rows.map((row) => [
            row.key,
            named
              .filter((other) => other.key !== row.key)
              .map((other) => ({ name: other.name.trim(), colour: other.colour })),
          ]),
        ),
      };
    }
    return this.users.byKey.get(key)!;
  }
  private choicesFor(key: string) {
    let choices = this.colourChoices.get(key);
    if (!choices) {
      choices = rememberedColourChoices((colour) => t(`hours.colour.${colour}`));
      this.colourChoices.set(key, choices);
    }
    return choices(this.usersOf(key));
  }
  private readonly usedByLabel = (colour: string, names: string) =>
    format("hours.colour_used_by", { colour, names });
  private close() {
    void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
  }
  private until(key: string): string {
    const until = runsUntil(this.rows, key);
    return until === null ? "" : formatMonthDay(until);
  }
  private dayOptions(month: string) {
    return Array.from({ length: month ? daysIn(month) : 31 }, (_, index) => ({
      value: String(index + 1),
      label: String(index + 1),
    }));
  }
  private readonly monthOptions = () =>
    MONTHS.map((month) => ({ value: month, label: formatMonthName(Number(month)) }));

  private editableRow(row: SeasonRow, index: number) {
    const on =
      (field: RowField) =>
      (event: CustomEvent<{ value: string }>): void => {
        event.stopPropagation();
        this.change(row.key, field, event.detail.value);
      };
    const name = row.name.trim();
    return html`<tr data-row=${row.key}>
      <td>
        <wt-colour-chooser
          name=${`season-${index}-colour`}
          label=${t("hours.colour")}
          hide-label
          .value=${row.colour}
          .choices=${this.choicesFor(row.key)}
          .usedByLabel=${this.usedByLabel}
          @wt-change=${on("colour")}
        ></wt-colour-chooser>
      </td>
      <td class="name">
        <wt-input
          name=${`season-${index}-name`}
          label=${t("prep.name")}
          required
          hide-label
          .value=${row.name}
          @wt-change=${on("name")}
        ></wt-input>
      </td>
      <td>
        <div class="start">
          <wt-combobox
            name=${`season-${index}-day`}
            label=${t("season.day")}
            required
            hide-label
            search="never"
            .value=${row.day}
            .options=${this.dayOptions(row.month)}
            @wt-change=${on("day")}
          ></wt-combobox>
          <wt-combobox
            name=${`season-${index}-month`}
            label=${t("season.month")}
            required
            hide-label
            search="never"
            .value=${row.month}
            .options=${this.monthOptions()}
            @wt-change=${on("month")}
          ></wt-combobox>
        </div>
      </td>
      <td class="until" data-test="runs-until">${this.until(row.key)}</td>
      <td class="bin">
        <wt-button
          variant="ghost"
          data-test="delete-season"
          aria-label=${name ? format("season.delete_named", { name }) : t("season.delete_new")}
          ?disabled=${this.rows.length === 1}
          @click=${() => {
            this.draft = removeRow(this.draft!, row.key, this.seasons);
          }}
          ><wt-icon name="bin"></wt-icon
        ></wt-button>
      </td>
    </tr>`;
  }
  private readOnlyRow(row: SeasonRow) {
    return html`<tr data-row=${row.key}>
      <td>
        <span class="colour-text"
          ><span class="swatch" data-tint=${row.colour}></span
          >${t(`hours.colour.${row.colour}`)}</span
        >
      </td>
      <td>${row.name}</td>
      <td class="text">${formatMonthDay(`${row.month}-${row.day.padStart(2, "0")}`)}</td>
      <td class="until" data-test="runs-until">${this.until(row.key)}</td>
    </tr>`;
  }
  private table() {
    const editable = !this.readOnly;
    return html`<div
      class="table-wrap"
      tabindex="0"
      role="region"
      aria-label=${t("season.seasons")}
    >
      <table>
        <thead>
          <tr>
            <th scope="col">${t("hours.colour")}</th>
            <th scope="col">
              ${t("season.column_name")}${
                editable ? html`<span class="required" aria-hidden="true">*</span>` : nothing
              }
            </th>
            <th scope="col">
              ${t("season.starts")}${
                editable ? html`<span class="required" aria-hidden="true">*</span>` : nothing
              }
            </th>
            <th scope="col">${t("season.runs_until")}</th>
            ${
              editable
                ? html`<th scope="col">
                    <span class="visually-hidden">${t("prep.delete")}</span>
                  </th>`
                : nothing
            }
          </tr>
        </thead>
        <tbody>
          ${repeat(
            this.rows,
            (row) => row.key,
            (row, index) => (editable ? this.editableRow(row, index) : this.readOnlyRow(row)),
          )}
        </tbody>
      </table>
    </div>`;
  }
  private footer() {
    if (this.readOnly)
      return html`<wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="close-seasons"
          @click=${() => this.close()}
          >${t("calendar.window.close")}</wt-button
        >
      </wt-form-actions>`;
    const unchanged = sameDraft(this.draft!, this.baseline!);
    return html`<wt-form-actions slot="footer">
      <wt-button
        slot="cancel"
        variant="secondary"
        data-test="cancel-seasons"
        @click=${() => this.close()}
        >${t("prep.cancel")}</wt-button
      >
      <wt-button
        data-test="save-seasons"
        variant=${unchanged ? "secondary" : "primary"}
        ?disabled=${unchanged}
        >${t("prep.save")}</wt-button
      >
    </wt-form-actions>`;
  }
  override render() {
    return html`<wt-modal open heading=${t("season.seasons")} .beforeClose=${this.beforeClose}>
      ${this.table()}
      ${
        this.readOnly
          ? nothing
          : html`<div class="below">
              <wt-button
                variant="secondary"
                data-test="add-season"
                @click=${() => {
                  this.draft = addRow(this.draft!);
                }}
                >${t("season.add")}</wt-button
              >
              <p class="hint" data-test="window-hint">${t("season.window_hint")}</p>
            </div>`
      }
      ${this.footer()}
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "seasons-window": SeasonsWindow;
  }
}
