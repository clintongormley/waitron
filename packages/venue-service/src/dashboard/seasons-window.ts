import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  FormFeedback,
  bottomMessage,
  saveActionState,
  submitOnEnter,
  type LeaveCoordinator,
  type DraftScope,
} from "@waitron/ui";
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
import { format, formatMonthName } from "./hours-view.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import {
  addRow,
  daysIn,
  draftOf,
  goneKeys,
  mergeSeasonDraft,
  rowErrors,
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
import { SEASON_TINT_TOKENS, seasonTintStyles } from "./season-tint.js";
import { t } from "./strings.js";
import { clockChangeConflictText } from "./clock-change-conflict.js";

const startOf = (row: SeasonRow): string => `${row.month}-${row.day.padStart(2, "0")}`;

const seasonOf = (row: SeasonRow): OpeningHoursModel["seasons"][number] => ({
  id: row.key,
  name: row.name,
  startsOn: startOf(row),
  colour: row.colour,
});

type RowField = "name" | "day" | "month" | "colour";
type Refused = { key: string; field: SeasonRefusedField; message: string };
interface Marks {
  own: Map<string, SeasonRowErrors>;
  refused?: Refused;
  gone: Set<string>;
}
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
        min-width: 0;
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
      }
      .start {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
        margin: 0;
      }
    `,
  ];
  @property({ attribute: false }) seasons: OpeningHoursModel["seasons"] = [];
  @property({ type: Number }) clockRevision = 0;
  @property() seasonId = "";
  @property({ attribute: false }) draftParent?: object;
  @property({ attribute: false }) api?: Pick<OpeningHoursApi, "saveSeasons">;
  /** Replaced whole on every change, so a restore can swap it while keeping the live `next`. */
  @state() private draft?: SeasonDraft;
  private baseline?: SeasonDraft;
  private readonly feedback = new FormFeedback(this);
  /** A refusal with the row keys of the request it answered, in the order of its `save` entries. */
  @state() private refusal?: { refusal: Refusal; keys: readonly string[] };
  /** The opening a Save in flight was sent from. */
  @state() private saving?: object;
  private scope?: DraftScope<SeasonDraft>;
  private leave?: LeaveCoordinator;
  private blank?: SeasonRow;
  private get targetKey() {
    return this.seasonId || this.blank?.key;
  }
  private get scopeBaseline(): SeasonDraft {
    return this.blank
      ? { ...this.baseline!, rows: [...this.baseline!.rows, this.blank] }
      : this.baseline!;
  }
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
      this.draft = this.seasonId ? this.baseline : addRow(this.baseline);
      this.blank = this.seasonId ? undefined : this.draft.rows.at(-1);
    } else if (changed.has("seasons")) {
      this.follow(this.seasons);
    }
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor<SeasonDraft>(this, {
        id: {},
        parent: this.draftParent,
        current: () => this.draft!,
        snapshot: (draft) => draft,
        equal: sameDraft,
        // The live counter is kept, so a Discard never hands a later row a key already used.
        restore: (snapshot) => {
          this.draft = { ...snapshot, next: Math.max(this.draft!.next, snapshot.next) };
          this.feedback.reset();
          this.refusal = undefined;
        },
      });
      scope.commit(this.scopeBaseline);
      this.scope = scope;
      this.leave = coordinator;
      if (!scope.isDirty()) this.revision = this.clockRevision;
    } else if ((changed.has("clockRevision") || changed.has("seasons")) && !this.scope?.isDirty()) {
      this.revision = this.clockRevision;
    }
  }
  /** Folds a newer list into the draft; the live `next` is kept so a new row's key is never reused. */
  private follow(latest: OpeningHoursModel["seasons"]) {
    const draft = this.draft!;
    const merged = mergeSeasonDraft(draft, this.baseline!, latest);
    const selected = draft.rows.find((row) => row.key === this.targetKey);
    const rows =
      selected && !merged.draft.rows.some((row) => row.key === selected.key)
        ? [...merged.draft.rows, selected]
        : merged.draft.rows;
    this.draft = { ...merged.draft, rows, next: Math.max(draft.next, merged.draft.next) };
    this.baseline = merged.baseline;
    this.scope?.commit(this.scopeBaseline);
  }
  private get busy(): boolean {
    return this.saving !== undefined && this.saving === this.generation;
  }
  private setDraft(draft: SeasonDraft) {
    this.draft = draft;
    this.scope?.changed();
  }
  /** The refused field, and the key of the row it belongs to. */
  private refused(): Refused | undefined {
    if (!this.refusal) return undefined;
    const found = seasonRefusalField(this.refusal.refusal);
    const key = found ? this.refusal.keys[found.index] : undefined;
    return found && key !== undefined
      ? { key, field: found.field, message: found.message }
      : undefined;
  }
  private errorsOf(
    row: SeasonRow,
    { own, refused, gone }: Marks,
  ): Partial<Record<SeasonRefusedField, string>> {
    const errors: Partial<Record<SeasonRefusedField, string>> = {};
    const mine = own.get(row.key);
    if (mine?.name)
      errors.name = t(mine.name === "taken" ? "season.name_taken" : "prep.name_required");
    if (mine?.startsOn)
      errors.startsOn = t(
        mine.startsOn === "taken" ? "season.start_taken" : "season.start_required",
      );
    if (refused?.key === row.key) errors[refused.field] = refused.message;
    if (gone.has(row.key)) errors.name = t("season.not_found");
    return errors;
  }
  private gone(): Set<string> {
    return new Set(goneKeys(this.draft!, this.baseline!));
  }
  private ownErrors(): Map<string, SeasonRowErrors> {
    return this.feedback.attempted
      ? new Map([...rowErrors(this.rows)].filter(([key]) => key === this.targetKey))
      : new Map();
  }
  private async save() {
    if (this.busy || !this.api || saveActionState(this.scope).unchanged) return;
    this.feedback.press();
    this.refusal = undefined;
    if (rowErrors(this.rows).has(this.targetKey!)) {
      void this.feedback.focus(this.shadowRoot!);
      return;
    }
    const generation = this.generation;
    const listed = this.seasons;
    const submitted = this.draft!;
    const { change, keys } = seasonChange(
      { ...submitted, rows: submitted.rows.filter((row) => row.key === this.targetKey) },
      this.baseline!,
    );
    this.saving = generation;
    try {
      const saved = await this.api.saveSeasons(change, this.revision);
      if (generation !== this.generation) return;
      // The saved list is the new baseline, so the snapshot that follows finds nothing changed; a
      // list delivered while the Save was in flight is kept over the answer.
      this.baseline = draftOf(this.seasons === listed ? saved : this.seasons);
      this.draft = { ...this.baseline, next: Math.max(this.draft!.next, submitted.next) };
      this.blank = undefined;
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
      const gone = this.baseline!.rows.find((row) => row.key === goneId);
      if (gone) this.follow(this.baseline!.rows.filter((row) => row.key !== goneId).map(seasonOf));
      this.refusal = { refusal, keys };
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
      choices = rememberedColourChoices(
        (colour) => t(`hours.colour.${colour}`),
        (colour) => SEASON_TINT_TOKENS[colour].tint,
      );
      this.colourChoices.set(key, choices);
    }
    return choices(this.usersOf(key));
  }
  private readonly usedByLabel = (colour: string, names: string) =>
    format("hours.colour_used_by", { colour, names });
  async requestClose(): Promise<boolean> {
    if (this.busy) return false;
    if (this.scope && this.leave) {
      const outcome = await this.leave.request({
        scopes: [this.scope.id],
        reason: "navigation",
        proceed() {},
      });
      if (outcome !== "proceeded") return false;
    }
    this.dispatchEvent(new CustomEvent("season-cancel", { bubbles: true, composed: true }));
    return true;
  }
  private dayOptions(month: string) {
    return Array.from({ length: month ? daysIn(month) : 31 }, (_, index) => ({
      value: String(index + 1),
      label: String(index + 1),
    }));
  }
  private readonly monthOptions = () =>
    MONTHS.map((month) => ({
      value: month,
      label: formatMonthName(Number(month)),
      valueLabel: formatMonthName(Number(month), undefined, "short"),
    }));

  private editableRow(row: SeasonRow, marks: Marks) {
    const busy = this.busy;
    const errors = this.errorsOf(row, marks);
    const startError = errors.startsOn ?? "";
    const startErrorId = `start-error-${row.key}`;
    const on =
      (field: RowField) =>
      (event: CustomEvent<{ value: string }>): void => {
        event.stopPropagation();
        this.change(row.key, field, event.detail.value);
      };
    return html`<div class="form" data-row=${row.key}>
      <wt-input
        name="name"
        label=${t("prep.name")}
        required
        .value=${row.name}
        .error=${errors.name ?? ""}
        ?disabled=${busy}
        @wt-change=${on("name")}
      ></wt-input>
      <wt-colour-chooser
        name="colour"
        label=${t("hours.colour")}
        required
        .value=${row.colour}
        .choices=${this.choicesFor(row.key)}
        .usedByLabel=${this.usedByLabel}
        .error=${errors.colour ?? ""}
        ?disabled=${busy}
        @wt-change=${on("colour")}
      ></wt-colour-chooser>
      <div
        role="group"
        aria-label=${t("season.starts")}
        aria-describedby=${startError ? startErrorId : nothing}
      >
        <div class="start">
          <wt-combobox
            preserve-order
            stable-width
            name="day"
            label=${t("season.day")}
            required
            search="never"
            .value=${row.day}
            .options=${this.dayOptions(row.month)}
            ?invalid=${!!startError}
            ?disabled=${busy}
            @wt-change=${on("day")}
          ></wt-combobox>
          <wt-combobox
            preserve-order
            stable-width
            name="month"
            label=${t("season.month")}
            required
            search="never"
            .value=${row.month}
            .options=${this.monthOptions()}
            ?invalid=${!!startError}
            ?disabled=${busy}
            @wt-change=${on("month")}
          ></wt-combobox>
        </div>
        ${startError ? html`<p class="error" id=${startErrorId} data-error="startsOn">${startError}</p>` : nothing}
      </div>
    </div>`;
  }
  private footer({ own, refused, gone }: Marks) {
    const action = saveActionState(this.scope);
    const busy = this.busy;
    const marked =
      own.size > 0 || gone.size > 0 || this.rows.some((row) => row.key === refused?.key);
    const refusal = !this.refusal
      ? ""
      : seasonRefusalField(this.refusal.refusal)
        ? refused
          ? ""
          : t("prep.save_error")
        : (clockChangeConflictText(this.refusal.refusal) ??
          seasonRefusalText(this.refusal.refusal));
    return html`<wt-form-actions
      .error=${bottomMessage(refusal, marked ? t("prep.fix_fields") : "")}
    >
      <wt-button
        slot="cancel"
        variant="secondary"
        data-test="cancel-seasons"
        ?disabled=${busy}
        @click=${() => void this.requestClose()}
        >${t("prep.cancel")}</wt-button
      >
      <wt-button
        data-test="save-seasons"
        variant=${action.variant}
        ?disabled=${action.unchanged || busy || own.size > 0 || gone.size > 0}
        ?loading=${busy}
        @click=${() => void this.save()}
        >${t("prep.save")}</wt-button
      >
    </wt-form-actions>`;
  }
  override render() {
    const marks: Marks = { own: this.ownErrors(), refused: this.refused(), gone: this.gone() };
    const row = this.rows.find((row) => row.key === this.targetKey);
    return html`<div
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-seasons]"))}
    >
      ${row ? this.editableRow(row, marks) : nothing}${this.footer(marks)}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "seasons-window": SeasonsWindow;
  }
}
