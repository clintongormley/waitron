import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { HolidayFact, LocalDate } from "../hours-types.js";
import type { SpecialDayDetail, SpecialDayInput } from "../special-days.js";
import { holidayDateName } from "../holiday-naming.js";
import { addDays, isLocalDate } from "../hours-rules.js";
import { format, formatDate, formatLongDate } from "./hours-view.js";
import { t } from "./strings.js";

/** What the dialog sends: the special day's facts, never its paint. */
export type SpecialDayFacts = Pick<SpecialDayInput, "name" | "repeatsYearly"> & {
  dates: { date: LocalDate; closedAllDay: boolean }[];
};
type Field = "name" | "dates" | "repeatsYearly";
const fields: Field[] = ["name", "dates", "repeatsYearly"];
const MAX_ADDED = 366;

const copy = (value: SpecialDayFacts): SpecialDayFacts => ({
  ...value,
  dates: value.dates.map((entry) => ({ ...entry })),
});
const sameFacts = (a: SpecialDayFacts, b: SpecialDayFacts) =>
  a.name === b.name &&
  a.repeatsYearly === b.repeatsYearly &&
  a.dates.length === b.dates.length &&
  a.dates.every(
    (entry, index) =>
      entry.date === b.dates[index]!.date && entry.closedAllDay === b.dates[index]!.closedAllDay,
  );
const byDate = (dates: SpecialDayFacts["dates"]) =>
  [...dates].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

@customElement("special-day-dialog")
export class SpecialDayDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
        padding-block: var(--wt-space-3);
      }
      p {
        margin: 0;
      }
      .error {
        color: var(--wt-color-danger);
      }
      .label {
        margin-block-end: var(--wt-space-1);
        font-weight: var(--wt-font-weight-medium);
      }
      ul {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0 0 var(--wt-space-2);
        padding: 0;
        list-style: none;
      }
      li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
      }
      li .when {
        flex: 1 1 auto;
        min-width: 0;
      }
      .adding {
        display: grid;
        gap: var(--wt-space-2);
        margin-block-start: var(--wt-space-2);
      }
      .note {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .offer {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  /** The stored special day being edited; absent for a new one. */
  @property({ attribute: false }) specialDay?: SpecialDayDetail;
  /** A new special day's first date. */
  @property() date = "";
  /** The public holidays the host knows of, for the pre-fill and the holiday-name note. */
  @property({ attribute: false }) holidays: readonly HolidayFact[] = [];
  /** Special days the host knows of, for the "Add to <name>" offer. */
  /** Special days the host knows of, for the "Add to <name>" offer; `latest` is a day's last date. */
  @property({ attribute: false }) existing: readonly {
    id: string;
    name: string;
    latest?: LocalDate;
  }[] = [];
  @property({ attribute: false }) refusal?: { code: string; params?: Record<string, unknown> };
  @state() private draft: SpecialDayFacts = { name: "", repeatsYearly: false, dates: [] };
  @state() private attempted = false;
  @state() private adding = false;
  @state() private addFrom = "";
  @state() private addTo = "";
  @state() private addErrors: { from?: string; to?: string } = {};
  @state() private offered = false;
  private scope?: DraftScope<SpecialDayFacts>;
  private leave?: LeaveCoordinator;
  private identity?: object;
  private dayId?: string;
  private baseline?: SpecialDayFacts;
  private savableAtOpen = false;
  /** The public holiday each stored date was saved on. */
  private storedHolidays = new Set<LocalDate>();
  private generation = {};
  private submittedGeneration?: object;

  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    if (!this.open) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = undefined;
      this.baseline = undefined;
      this.generation = {};
      return;
    }
    if (!this.identity || this.dayId !== this.specialDay?.id) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = {};
      this.generation = {};
      this.dayId = this.specialDay?.id;
      const holiday = this.specialDay ? "" : holidayDateName(this.holidays, this.date, "");
      this.draft = this.specialDay
        ? {
            name: this.specialDay.name,
            repeatsYearly: this.specialDay.repeatsYearly,
            dates: byDate(
              this.specialDay.dates.map(({ date, closedAllDay }) => ({ date, closedAllDay })),
            ),
          }
        : {
            name: holiday,
            repeatsYearly: false,
            dates: isLocalDate(this.date) ? [{ date: this.date, closedAllDay: false }] : [],
          };
      this.storedHolidays = new Set(
        (this.specialDay?.dates ?? []).flatMap((entry) => (entry.holidayName ? [entry.date] : [])),
      );
      this.savableAtOpen = !this.specialDay && holiday !== "";
      this.offered = holiday !== "" && this.existing.some((day) => day.name === holiday);
      this.baseline = copy(this.draft);
      this.attempted = false;
      this.adding = false;
      this.addFrom = "";
      this.addTo = "";
      this.addErrors = {};
      this.refusal = undefined;
    }
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: this.identity,
        current: () => this.input,
        snapshot: copy,
        equal: sameFacts,
        restore: (value) => {
          this.draft = copy(value);
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
  }
  private get input(): SpecialDayFacts {
    return { ...copy(this.draft), name: this.draft.name.trim() };
  }
  private get ownErrors(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (!this.input.name) errors.name = t("prep.name_required");
    if (!this.draft.dates.length) errors.dates = t("special.dates_required");
    return errors;
  }
  private refusalField(): Field | undefined {
    const code = this.refusal?.code;
    if (code === "special_day.date_taken") return "dates";
    if (code !== "special_day.invalid") return undefined;
    const field = String(this.refusal?.params?.field ?? "");
    if (field === "name" || field === "repeatsYearly") return field;
    return field === "dates" || field.startsWith("dates.") ? "dates" : undefined;
  }
  private error(field: Field): string {
    if (this.refusalField() === field) {
      const params = this.refusal?.params ?? {};
      if (this.refusal?.code === "special_day.date_taken" && isLocalDate(params.date))
        return format("special.date_taken", {
          name: String(params.name ?? ""),
          date: formatDate(params.date as LocalDate),
        });
      if (this.refusal?.params?.reason === "overlap") {
        const index = Number(String(params.field).split(".")[1]);
        const date = this.draft.dates[index]?.date;
        if (date) return format("special.date_meets", { date: formatDate(date) });
      }
      return t("special.field_refused");
    }
    return this.attempted ? (this.ownErrors[field] ?? "") : "";
  }
  private update_(next: SpecialDayFacts, field: Field) {
    this.draft = next;
    if (this.refusalField() === field) this.refusal = undefined;
    this.scope?.changed();
  }
  private addDates() {
    const errors: { from?: string; to?: string } = {};
    if (!isLocalDate(this.addFrom)) errors.from = t("special.date_required");
    else if (this.addTo !== "" && !isLocalDate(this.addTo)) errors.to = t("special.date_required");
    else if (this.addTo !== "" && this.addTo < this.addFrom) errors.to = t("special.range_order");
    const added: LocalDate[] = [];
    if (!errors.from && !errors.to) {
      const last = this.addTo || this.addFrom;
      for (let date = this.addFrom; date <= last; date = addDays(date, 1)) {
        if (added.length === MAX_ADDED) {
          errors.to = t("special.range_long");
          break;
        }
        added.push(date);
      }
    }
    this.addErrors = errors;
    if (errors.from || errors.to) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    const held = new Set(this.draft.dates.map((entry) => entry.date));
    this.update_(
      {
        ...this.draft,
        dates: byDate([
          ...this.draft.dates,
          ...added.filter((date) => !held.has(date)).map((date) => ({ date, closedAllDay: false })),
        ]),
      },
      "dates",
    );
    this.adding = false;
    this.addFrom = "";
    this.addTo = "";
  }
  private actionState() {
    return saveActionState(this.scope, { savableAtOpen: this.savableAtOpen });
  }
  private save() {
    if (!this.open || !this.isConnected || this.busy || this.actionState().unchanged) return;
    this.attempted = true;
    this.refusal = undefined;
    if (Object.keys(this.ownErrors).length) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.submittedGeneration = this.generation;
    this.dispatchEvent(
      new CustomEvent("special-day-save", {
        detail: { id: this.specialDay?.id ?? null, input: this.input },
        bubbles: true,
        composed: true,
      }),
    );
  }
  commitSubmitted(input: SpecialDayFacts): boolean {
    if (!this.open || !this.isConnected || this.submittedGeneration !== this.generation)
      return false;
    this.baseline = copy(input);
    this.savableAtOpen = false;
    this.scope?.commit(input);
    return !this.scope?.isDirty();
  }
  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.isConnected || this.busy) return false;
    if (!this.scope || !this.leave) return true;
    const generation = this.generation;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.isConnected && generation === this.generation && outcome === "proceeded";
  };
  /** The same-named special day with the latest date; on a tie, the lowest id. */
  private offerMatch() {
    const name = this.draft.name;
    return this.existing
      .filter((day) => day.name === name)
      .sort((a, b) =>
        (a.latest ?? "") !== (b.latest ?? "")
          ? (a.latest ?? "") < (b.latest ?? "")
            ? 1
            : -1
          : a.id < b.id
            ? -1
            : 1,
      )[0]!;
  }
  private offer(current: () => boolean) {
    const name = this.draft.name;
    const match = this.offerMatch();
    const params = this.refusal?.params ?? {};
    const refused = !this.refusal
      ? ""
      : this.refusal.code === "special_day.date_taken" && isLocalDate(params.date)
        ? format("special.date_taken", {
            name: String(params.name ?? ""),
            date: formatDate(params.date as LocalDate),
          })
        : t("prep.save_error");
    return html`<div class="form">
      <p>${format("special.offer", { name })}</p>
      ${refused ? html`<p class="error" role="alert" data-error="offer">${refused}</p>` : nothing}
      <div class="offer">
        <wt-button
          data-test="add-to"
          ?disabled=${this.busy}
          @click=${() => {
            if (current())
              this.dispatchEvent(
                new CustomEvent("special-day-add-to", {
                  detail: { id: match.id, date: this.draft.dates[0]!.date },
                  bubbles: true,
                  composed: true,
                }),
              );
          }}
          >${format("special.add_to", { name })}</wt-button
        >
        <wt-button
          data-test="new-instead"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => {
            if (current()) this.offered = false;
          }}
          >${t("special.new")}</wt-button
        >
      </div>
    </div>`;
  }
  private datesField(current: () => boolean) {
    const error = this.error("dates");
    return html`<div>
      <p class="label" id="dates-label">${t("special.dates")} *</p>
      <ul aria-labelledby="dates-label">
        ${this.draft.dates.map(
          (entry) =>
            html`<li data-date=${entry.date}>
              <span class="when">${formatDate(entry.date)}</span>
              <wt-switch
                name=${`closed.${entry.date}`}
                label=${t("special.closed")}
                accessible-name=${`${t("special.closed")}, ${formatLongDate(entry.date)}`}
                .checked=${entry.closedAllDay}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                  event.stopPropagation();
                  if (!current()) return;
                  this.update_(
                    {
                      ...this.draft,
                      dates: this.draft.dates.map((other) =>
                        other.date === entry.date
                          ? { ...other, closedAllDay: event.detail.checked }
                          : other,
                      ),
                    },
                    "dates",
                  );
                }}
              ></wt-switch>
              <wt-button
                data-test="remove-date"
                variant="secondary"
                aria-label=${format("special.remove_date", { date: formatLongDate(entry.date) })}
                ?disabled=${this.busy}
                @click=${() => {
                  if (current())
                    this.update_(
                      {
                        ...this.draft,
                        dates: this.draft.dates.filter((other) => other.date !== entry.date),
                      },
                      "dates",
                    );
                }}
                >×</wt-button
              >
            </li>`,
        )}
      </ul>
      ${error ? html`<p class="error" role="alert" data-error="dates">${error}</p>` : nothing}
      ${
        this.adding
          ? html`<div class="adding">
              <wt-input
                name="addFrom"
                type="date"
                label=${t("special.from")}
                required
                .value=${this.addFrom}
                .error=${this.addErrors.from ?? ""}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  if (!current()) return;
                  this.addFrom = event.detail.value;
                  this.addErrors = {};
                }}
              ></wt-input>
              <wt-input
                name="addTo"
                type="date"
                label=${t("special.to")}
                hint=${t("special.to_hint")}
                .value=${this.addTo}
                .error=${this.addErrors.to ?? ""}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  if (!current()) return;
                  this.addTo = event.detail.value;
                  this.addErrors = {};
                }}
              ></wt-input>
              <div>
                <wt-button
                  data-test="add-dates-confirm"
                  variant="secondary"
                  ?disabled=${this.busy}
                  @click=${() => {
                    if (current()) this.addDates();
                  }}
                  >${t("special.add")}</wt-button
                >
              </div>
            </div>`
          : html`<wt-button
              data-test="add-dates"
              variant="secondary"
              ?disabled=${this.busy}
              @click=${() => {
                if (current()) this.adding = true;
              }}
              >${t("special.add_dates")}</wt-button
            >`
      }
    </div>`;
  }
  override render(): unknown {
    if (!this.open) return nothing;
    const action = this.actionState();
    const generation = this.generation;
    const current = () =>
      this.isConnected && this.open && !this.busy && generation === this.generation;
    const holidayDates = new Set(this.holidays.map((holiday) => holiday.date));
    const onHoliday = this.draft.dates.some(
      (entry) => holidayDates.has(entry.date) || this.storedHolidays.has(entry.date),
    );
    const leap =
      this.draft.repeatsYearly && this.draft.dates.some((entry) => entry.date.endsWith("-02-29"));
    const repeatError = this.error("repeatsYearly");
    const bottom = this.refusal && this.refusalField() === undefined ? t("prep.save_error") : "";
    return keyed(
      generation,
      html`<wt-modal
        open
        size="compact"
        heading=${t(this.specialDay ? "special.edit" : "special.new")}
        .dismissible=${!this.busy}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (current()) {
            this.open = false;
            this.dispatchEvent(
              new CustomEvent("special-day-close", { bubbles: true, composed: true }),
            );
          }
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (current() && !this.offered && !this.adding)
            submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-special-day]"));
        }}
      >
        ${
          this.offered
            ? this.offer(current)
            : html`<div class="form">
                <wt-input
                  name="name"
                  label=${t("prep.name")}
                  required
                  .value=${this.draft.name}
                  .error=${this.error("name")}
                  ?disabled=${this.busy}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    if (current())
                      this.update_({ ...this.draft, name: event.detail.value }, "name");
                  }}
                ></wt-input>
                ${this.datesField(current)}
                <div>
                  <wt-switch
                    name="repeats"
                    label=${t("special.every_year")}
                    .checked=${this.draft.repeatsYearly}
                    .description=${repeatError}
                    ?disabled=${this.busy}
                    @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                      event.stopPropagation();
                      if (current())
                        this.update_(
                          { ...this.draft, repeatsYearly: event.detail.checked },
                          "repeatsYearly",
                        );
                    }}
                  ></wt-switch>
                  ${repeatError ? html`<p class="error" role="alert" data-error="repeats">${repeatError}</p>` : nothing}
                  ${onHoliday ? html`<p class="note" data-test="holiday-note">${t("special.holiday_note")}</p>` : nothing}
                  ${leap ? html`<p class="note">${t("special.leap")}</p>` : nothing}
                </div>
              </div>`
        }
        ${
          this.offered
            ? nothing
            : html`<wt-form-actions
                slot="footer"
                .error=${[bottom, fields.some((field) => this.error(field)) ? t("prep.fix_fields") : ""].filter(Boolean).join(" ")}
              >
                <wt-button
                  slot="cancel"
                  variant="secondary"
                  ?disabled=${this.busy}
                  @click=${() => {
                    if (current())
                      void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
                  }}
                  >${t("prep.cancel")}</wt-button
                >
                <wt-button
                  data-test="save-special-day"
                  variant=${action.variant}
                  ?disabled=${action.unchanged || this.busy || (this.attempted && Object.keys(this.ownErrors).length > 0)}
                  ?loading=${this.busy}
                  @click=${() => {
                    if (current()) this.save();
                  }}
                  >${t("prep.save")}</wt-button
                >
              </wt-form-actions>`
        }
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "special-day-dialog": SpecialDayDialog;
  }
}
