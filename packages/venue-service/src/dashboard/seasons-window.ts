import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveReason,
} from "@waitron/ui";
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
  rowErrors,
  runsUntil,
  sameDraft,
  seasonChange,
  type SeasonDraft,
  type SeasonRow,
  type SeasonRowErrors,
} from "./season-draft.js";
import { seasonRefusalField, seasonRefusalText } from "./season-refusal.js";
import { refusalOf, type Refusal } from "./refusal.js";
import { seasonTintStyles } from "./season-tint.js";
import { t } from "./strings.js";

type RowField = "name" | "day" | "month" | "colour";
type ErrorField = "name" | "startsOn" | "colour";
const errorFieldOf = (field: RowField): ErrorField =>
  field === "day" || field === "month" ? "startsOn" : field;

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
      .error {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
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
  @state() private attempted = false;
  /** A refusal with the row keys of the request it answered, in the order of its `save` entries. */
  @state() private refusal?: { refusal: Refusal; keys: readonly string[] };
  /** The opening a Save in flight was sent from. */
  @state() private saving?: object;
  private scope?: DraftScope<SeasonDraft>;
  /** Replaced on every connect and disconnect, so an answer sent from an earlier opening is ignored. */
  private generation = {};
  /** The clock revision the draft was last clean at. */
  private revision = 0;
  private readonly colourChoices = new Map<string, ReturnType<typeof rememberedColourChoices>>();
  private users?: { draft: SeasonDraft; byKey: Map<string, readonly ColourUser[]> };

  override connectedCallback() {
    super.connectedCallback();
    this.generation = {};
    this.dataset.test = "calendar-window";
    this.dataset.window = "seasons";
  }
  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.generation = {};
    super.disconnectedCallback();
  }
  protected override willUpdate(changed: PropertyValues<this>) {
    if (!this.draft) {
      this.baseline = draftOf(this.seasons);
      this.draft = this.baseline;
    }
    if (this.isConnected && !this.readOnly && !this.scope) {
      const { scope } = draftScopeFor<SeasonDraft>(this, {
        id: {},
        parent: this.draftParent,
        current: () => this.draft!,
        snapshot: (draft) => draft,
        equal: sameDraft,
        // The live counter is kept, so a Discard never hands a later row a key already used.
        restore: (snapshot) => {
          this.draft = { ...snapshot, next: Math.max(this.draft!.next, snapshot.next) };
        },
      });
      scope.commit(this.baseline!);
      this.scope = scope;
      if (!scope.isDirty()) this.revision = this.clockRevision;
    } else if (changed.has("clockRevision") && !this.scope?.isDirty()) {
      this.revision = this.clockRevision;
    }
  }
  private get busy(): boolean {
    return this.saving !== undefined && this.saving === this.generation;
  }
  private setDraft(draft: SeasonDraft) {
    this.draft = draft;
    this.scope?.changed();
  }
  /** The refused field, and the key of the row it belongs to. */
  private refused(): { key: string; field: ErrorField; message: string } | undefined {
    if (!this.refusal) return undefined;
    const found = seasonRefusalField(this.refusal.refusal);
    const key = found ? this.refusal.keys[found.index] : undefined;
    return found && key !== undefined
      ? { key, field: found.field, message: found.message }
      : undefined;
  }
  private errorsOf(
    row: SeasonRow,
    own: Map<string, SeasonRowErrors>,
  ): Partial<Record<ErrorField, string>> {
    const errors: Partial<Record<ErrorField, string>> = {};
    const mine = own.get(row.key);
    if (mine?.name)
      errors.name = t(mine.name === "taken" ? "season.name_taken" : "prep.name_required");
    if (mine?.startsOn)
      errors.startsOn = t(
        mine.startsOn === "taken" ? "season.start_taken" : "season.start_required",
      );
    const refused = this.refused();
    if (refused?.key === row.key) errors[refused.field] = refused.message;
    return errors;
  }
  private ownErrors(): Map<string, SeasonRowErrors> {
    return this.attempted ? rowErrors(this.rows) : new Map();
  }
  private async save() {
    if (this.readOnly || this.busy || !this.api || saveActionState(this.scope).unchanged) return;
    this.attempted = true;
    this.refusal = undefined;
    if (rowErrors(this.rows).size) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    const generation = this.generation;
    const submitted = this.draft!;
    const { change, keys } = seasonChange(submitted, this.baseline!);
    this.saving = generation;
    try {
      const saved = await this.api.saveSeasons(change, this.revision);
      if (generation !== this.generation) return;
      this.scope?.commit(submitted);
      this.dispatchEvent(
        new CustomEvent<{ seasons: OpeningHoursModel["seasons"] }>("seasons-saved", {
          detail: { seasons: saved },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      if (generation === this.generation) this.refusal = { refusal: refusalOf(error), keys };
    } finally {
      if (this.saving === generation) this.saving = undefined;
    }
  }
  private get rows(): readonly SeasonRow[] {
    return this.draft!.rows;
  }
  private change(key: string, field: RowField, value: string) {
    const refused = this.refused();
    if (refused?.key === key && refused.field === errorFieldOf(field)) this.refusal = undefined;
    const draft = this.draft!;
    this.setDraft({
      ...draft,
      rows: draft.rows.map((row) => {
        if (row.key !== key) return row;
        if (field === "colour") return { ...row, colour: value as CalendarColour };
        if (field !== "month") return { ...row, [field]: value };
        const day = row.day && Number(row.day) > daysIn(value) ? String(daysIn(value)) : row.day;
        return { ...row, day, month: value };
      }),
    });
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

  private editableRow(row: SeasonRow, index: number, own: Map<string, SeasonRowErrors>) {
    const busy = this.busy;
    const errors = this.errorsOf(row, own);
    const startError = errors.startsOn ?? "";
    const startErrorId = `start-error-${row.key}`;
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
          .error=${errors.colour ?? ""}
          ?disabled=${busy}
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
          .error=${errors.name ?? ""}
          ?disabled=${busy}
          @wt-change=${on("name")}
        ></wt-input>
      </td>
      <td>
        <div
          class="start"
          role="group"
          aria-label=${t("season.starts")}
          aria-describedby=${startError ? startErrorId : nothing}
        >
          <wt-combobox
            name=${`season-${index}-day`}
            label=${t("season.day")}
            required
            hide-label
            search="never"
            .value=${row.day}
            .options=${this.dayOptions(row.month)}
            ?invalid=${startError !== ""}
            ?disabled=${busy}
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
            ?invalid=${startError !== ""}
            ?disabled=${busy}
            @wt-change=${on("month")}
          ></wt-combobox>
        </div>
        ${
          startError
            ? html`<p class="error" id=${startErrorId} data-error="startsOn">${startError}</p>`
            : nothing
        }
      </td>
      <td class="until" data-test="runs-until">${this.until(row.key)}</td>
      <td class="bin">
        <wt-button
          variant="ghost"
          data-test="delete-season"
          aria-label=${name ? format("season.delete_named", { name }) : t("season.delete_new")}
          ?disabled=${busy || this.rows.length === 1}
          @click=${() => {
            this.setDraft(removeRow(this.draft!, row.key, this.seasons));
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
    const own = this.ownErrors();
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
            (row, index) => (editable ? this.editableRow(row, index, own) : this.readOnlyRow(row)),
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
    const action = saveActionState(this.scope);
    const own = this.ownErrors();
    const busy = this.busy;
    const marked = this.refused() !== undefined || own.size > 0;
    const refusal = this.refusal
      ? seasonRefusalText(this.refusal.refusal, this.seasons, this.specialDays)
      : "";
    return html`<wt-form-actions
      slot="footer"
      .error=${[refusal, marked ? t("prep.fix_fields") : ""].filter(Boolean).join(" ")}
    >
      <wt-button
        slot="cancel"
        variant="secondary"
        data-test="cancel-seasons"
        ?disabled=${busy}
        @click=${() => this.close()}
        >${t("prep.cancel")}</wt-button
      >
      <wt-button
        data-test="save-seasons"
        variant=${action.variant}
        ?disabled=${action.unchanged || busy || own.size > 0}
        ?loading=${busy}
        @click=${() => void this.save()}
        >${t("prep.save")}</wt-button
      >
    </wt-form-actions>`;
  }
  override render() {
    return html`<wt-modal
      open
      heading=${t("season.seasons")}
      .dismissible=${!this.busy}
      .beforeClose=${this.beforeClose}
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-seasons]"))}
    >
      ${this.table()}
      ${
        this.readOnly
          ? nothing
          : html`<div class="below">
              <wt-button
                variant="secondary"
                data-test="add-season"
                ?disabled=${this.busy}
                @click=${() => {
                  this.setDraft(addRow(this.draft!));
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
