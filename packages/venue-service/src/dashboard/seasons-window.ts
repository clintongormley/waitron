import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  visuallyHiddenStyles,
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
import { currentLocale } from "@waitron/dashboard-kit";
import type { CalendarColour } from "../hours-types.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { MONTHS } from "./calendar-grid.js";
import { rememberedColourChoices, type ColourUser } from "./calendar-colours.js";
import { format, formatMonthDay, formatMonthName } from "./hours-view.js";
import type { OpeningHoursApi, SeasonDeleteImpact } from "./opening-hours-client.js";
import {
  addRow,
  daysIn,
  draftOf,
  goneKeys,
  mergeSeasonDraft,
  removeRow,
  rowErrors,
  runsUntil,
  sameDraft,
  seasonChange,
  type SeasonDraft,
  type SeasonRow,
  type SeasonRowErrors,
} from "./season-draft.js";
import {
  seasonRefusalField,
  seasonRefusalText,
  type SeasonRefusedField,
} from "./season-refusal.js";
import { refusalOf, type Refusal } from "./refusal.js";
import { seasonTintStyles } from "./season-tint.js";
import { t } from "./strings.js";

const startOf = (row: SeasonRow): string => `${row.month}-${row.day.padStart(2, "0")}`;

const seasonOf = (row: SeasonRow): OpeningHoursModel["seasons"][number] => ({
  id: row.key,
  name: row.name,
  startsOn: startOf(row),
  colour: row.colour,
});

const listOf = (names: readonly string[]): string =>
  new Intl.ListFormat(currentLocale(), { style: "long", type: "conjunction" }).format(names);

type RowField = "name" | "day" | "month" | "colour";
const errorFieldOf = (field: RowField): SeasonRefusedField =>
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
        min-width: calc(var(--wt-space-6) * 2.75);
      }
      /* stable-width sizes it to its widest day; this floor stops a squeezed table shrinking it below. */
      .start wt-combobox[name$="-day"] {
        min-width: max-content;
      }
      .start wt-combobox[name$="-month"] {
        min-width: calc(var(--wt-space-6) * 4.5);
      }
      .until,
      .text {
        white-space: nowrap;
      }
      /* Opaque, so the columns scrolling under it at a phone's width do not show through. */
      .bin {
        position: sticky;
        inset-inline-end: 0;
        z-index: 1;
        width: 1%;
        text-align: end;
        background: var(--wt-color-surface-raised);
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
      .notes {
        display: grid;
        gap: var(--wt-space-1);
      }
      .notes p {
        margin: 0;
      }
      .notes p:first-child {
        margin-block-start: var(--wt-space-3);
      }
      .hint {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
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
  /** Each binned season's delete impact, by id; `token` is the newest read's, and only it may answer. */
  @state() private impacts = new Map<
    string,
    { token: object; impact?: SeasonDeleteImpact | "failed" }
  >();
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
    // The scope is taken in willUpdate; a host put back after a redraw has none until it redraws.
    this.requestUpdate();
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
    } else if (changed.has("seasons")) {
      this.follow(this.seasons);
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
          this.attempted = false;
          this.refusal = undefined;
        },
      });
      scope.commit(this.baseline!);
      this.scope = scope;
      if (!scope.isDirty()) this.revision = this.clockRevision;
    } else if ((changed.has("clockRevision") || changed.has("seasons")) && !this.scope?.isDirty()) {
      this.revision = this.clockRevision;
    }
  }
  /** Folds a newer list into the draft; the live `next` is kept so a new row's key is never reused. */
  private follow(latest: OpeningHoursModel["seasons"]) {
    const draft = this.draft!;
    const merged = mergeSeasonDraft(draft, this.baseline!, latest);
    this.draft = { ...merged.draft, next: Math.max(draft.next, merged.draft.next) };
    this.baseline = merged.baseline;
    this.scope?.commit(this.baseline);
  }
  private readonly guardClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.isConnected || this.busy) return false;
    return this.beforeClose ? this.beforeClose(reason) : true;
  };
  private get busy(): boolean {
    return this.saving !== undefined && this.saving === this.generation;
  }
  private setDraft(draft: SeasonDraft) {
    this.draft = draft;
    this.scope?.changed();
  }
  /** The refused field, and the key of the row it belongs to. */
  private refused(): { key: string; field: SeasonRefusedField; message: string } | undefined {
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
  ): Partial<Record<SeasonRefusedField, string>> {
    const errors: Partial<Record<SeasonRefusedField, string>> = {};
    const mine = own.get(row.key);
    if (mine?.name)
      errors.name = t(mine.name === "taken" ? "season.name_taken" : "prep.name_required");
    if (mine?.startsOn)
      errors.startsOn = t(
        mine.startsOn === "taken" ? "season.start_taken" : "season.start_required",
      );
    const refused = this.refused();
    if (refused?.key === row.key) errors[refused.field] = refused.message;
    if (this.gone().has(row.key)) errors.name = t("season.not_found");
    return errors;
  }
  private gone(): Set<string> {
    return new Set(goneKeys(this.draft!, this.baseline!));
  }
  private bin(key: string) {
    const index = this.rows.findIndex((row) => row.key === key);
    const draft = removeRow(this.draft!, key, this.baseline!.rows);
    const id = draft.deleted.find((each) => !this.draft!.deleted.includes(each));
    this.setDraft(draft);
    if (id !== undefined) void this.readImpact(id);
    void this.focusAfterBin(index);
  }
  /** The bin took its own button away; focus goes to the bin now in its place, else the one above, else + Season. */
  private async focusAfterBin(index: number) {
    await this.updateComplete;
    const bins = [
      ...this.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-button"]>(
        "[data-test=delete-season]",
      ),
    ].filter((bin) => !bin.disabled);
    const target =
      bins[index] ??
      bins[index - 1] ??
      this.shadowRoot!.querySelector<HTMLElement>("[data-test=add-season]");
    target?.focus();
  }
  private async readImpact(id: string) {
    const api = this.api;
    if (!api) return;
    const token = {};
    this.impacts = new Map(this.impacts).set(id, { token });
    let impact: SeasonDeleteImpact | "failed";
    try {
      impact = await api.readSeasonDeleteImpact(id);
    } catch {
      impact = "failed";
    }
    if (this.impacts.get(id)?.token !== token) return;
    this.impacts = new Map(this.impacts).set(id, { token, impact });
  }
  /**
   * The named rows that will hold some of a binned season's stored days: the row holding its start,
   * then each row starting before the next stored start, in start order round the year.
   */
  private receivers(season: SeasonRow): string[] {
    const start = startOf(season);
    // Prefixed so plain string order runs round the year from the binned season's start.
    const from = (row: SeasonRow) => (startOf(row) >= start ? "0" : "1") + startOf(row);
    const end = this.baseline!.rows.reduce(
      (soonest, row) => (row.key !== season.key && from(row) < soonest ? from(row) : soonest),
      "2",
    );
    const proposed = this.rows
      .filter((row) => row.day && row.month)
      .map((row) => ({ at: from(row), row }))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const holding = proposed[0]?.at === `0${start}` ? proposed[0] : proposed.at(-1);
    const inside = proposed.filter((each) => each.at > `0${start}` && each.at < end);
    const rows = new Set([holding, ...inside].flatMap((each) => (each ? [each.row] : [])));
    return [...rows].flatMap((row) => row.name.trim() || []);
  }
  private deleteNotes() {
    const notes = this.draft!.deleted.map((id) => {
      // A merge keeps only binned ids the new list still holds, and the baseline holds that list.
      const season = this.baseline!.rows.find((row) => row.key === id)!;
      const found = this.impacts.get(id)?.impact;
      const loses =
        found === undefined
          ? ""
          : found === "failed"
            ? t("season.delete_loses_unknown")
            : found.departments.length
              ? format("season.delete_loses", {
                  departments: listOf(found.departments.map((department) => department.name)),
                })
              : t("season.delete_loses_none");
      const receivers = this.receivers(season);
      const deletes = receivers.length
        ? format("season.delete_pending", { name: season.name, previous: listOf(receivers) })
        : format("season.delete_pending_alone", { name: season.name });
      return html`<p data-test="delete-note">${deletes} ${loses}</p>`;
    });
    return html`<div class="notes" role="status">${notes}</div>`;
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
    const listed = this.seasons;
    const submitted = this.draft!;
    const { change, keys } = seasonChange(submitted, this.baseline!);
    this.saving = generation;
    try {
      const saved = await this.api.saveSeasons(change, this.revision);
      if (generation !== this.generation) return;
      // The saved list is the new baseline, so the snapshot that follows finds nothing changed; a
      // list delivered while the Save was in flight is kept over the answer.
      this.baseline = draftOf(this.seasons === listed ? saved : this.seasons);
      this.draft = { ...this.baseline, next: submitted.next };
      this.scope?.commit(this.baseline);
      this.dispatchEvent(
        new CustomEvent<{ seasons: OpeningHoursModel["seasons"] }>("seasons-saved", {
          detail: { seasons: saved },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      if (generation !== this.generation) return;
      const refusal = refusalOf(error);
      const goneId = refusal.code === "season.not_found" ? refusal.params?.seasonId : undefined;
      if (this.baseline!.rows.some((row) => row.key === goneId))
        this.follow(this.baseline!.rows.filter((row) => row.key !== goneId).map(seasonOf));
      else this.refusal = { refusal, keys };
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
            stable-width
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
          @click=${() => this.bin(row.key)}
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
      <td class="text">${formatMonthDay(startOf(row))}</td>
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
                ? html`<th scope="col" class="bin">
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
    const refused = this.refused();
    const gone = this.gone().size > 0;
    const marked = own.size > 0 || gone || this.rows.some((row) => row.key === refused?.key);
    const refusal = !this.refusal
      ? ""
      : seasonRefusalField(this.refusal.refusal)
        ? refused
          ? ""
          : t("prep.save_error")
        : seasonRefusalText(this.refusal.refusal, this.seasons, this.specialDays);
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
        ?disabled=${action.unchanged || busy || own.size > 0 || gone}
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
      .beforeClose=${this.guardClose}
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-seasons]"))}
    >
      ${this.table()} ${this.readOnly ? nothing : this.deleteNotes()}
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
