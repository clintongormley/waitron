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
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { isLocalDate } from "../hours-rules.js";
import type { LocalDate } from "../hours-types.js";
import type { Season } from "../season-rules.js";
import type { SeasonInput } from "./opening-hours-client.js";
import { format, formatDate, formatMonthName } from "./hours-view.js";
import { t } from "./strings.js";
import { currentLocale } from "@waitron/dashboard-kit";

export type SeasonChip = Season & { lastDay: string };
type Draft = { name: string; day: string; month: string };
type Field = "name" | "startsOn";
const fields: Field[] = ["name", "startsOn"];

/** 29 February is never a start, so February always offers 28 days. */
const daysIn = (month: string) =>
  month === "02" ? 28 : new Date(Date.UTC(2001, Number(month), 0)).getUTCDate();
const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
const copy = (draft: Draft): Draft => ({ ...draft });
const same = (a: Draft, b: Draft) => a.name === b.name && a.day === b.day && a.month === b.month;
const draftOf = (season?: Season): Draft =>
  season
    ? {
        name: season.name,
        day: String(Number(season.startsOn.slice(3))),
        month: season.startsOn.slice(0, 2),
      }
    : { name: "", day: "", month: "" };

@customElement("season-dialog")
export class SeasonDialog extends LitElement {
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
      fieldset {
        margin: 0;
        padding: 0;
        border: 0;
        min-width: 0;
      }
      legend {
        padding: 0;
        margin-block-end: var(--wt-space-1);
        font-weight: var(--wt-font-weight-medium);
      }
      .start {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
        gap: var(--wt-space-3);
      }
      p {
        margin: 0;
      }
      .error,
      .required {
        color: var(--wt-color-danger);
      }
      .required {
        margin-inline-start: var(--wt-space-1);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  /** The request in flight, so only the action that sent it shows it is busy. */
  @property() pending: "save" | "impact" | "delete" | "" = "";
  /** Reading the delete impact failed. */
  @property({ type: Boolean }) impactFailed = false;
  /** The season being edited; absent for a new one. */
  @property({ attribute: false }) season?: SeasonChip;
  /** Every season, for Delete's availability and for naming a season in a refusal. */
  @property({ attribute: false }) seasons: readonly SeasonChip[] = [];
  /** Special days by id, for naming one in an end-offset refusal. */
  @property({ attribute: false }) specialDays: readonly { id: string; name: string }[] = [];
  @property({ attribute: false }) refusal?: { code: string; params?: Record<string, unknown> };
  /** Set while Delete waits for its confirmation: the departments whose hours it would lose. */
  @property({ attribute: false }) confirmDelete?: { departments: readonly { name: string }[] };
  @state() private draft: Draft = draftOf();
  @state() private attempted = false;
  private get busy() {
    return this.pending !== "";
  }
  private scope?: DraftScope<Draft>;
  private leave?: LeaveCoordinator;
  private identity?: object;
  private seasonId?: string;
  private baseline?: Draft;
  private generation = {};

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
    if (!this.identity || this.seasonId !== this.season?.id) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = {};
      this.generation = {};
      this.seasonId = this.season?.id;
      this.draft = draftOf(this.season);
      this.baseline = copy(this.draft);
      this.attempted = false;
      this.refusal = undefined;
    }
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: this.identity,
        current: () => copy(this.draft),
        snapshot: copy,
        equal: same,
        restore: (value) => {
          this.draft = copy(value);
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
  }
  private get input(): SeasonInput {
    return {
      name: this.draft.name.trim(),
      startsOn: `${this.draft.month}-${this.draft.day.padStart(2, "0")}`,
    };
  }
  private get ownErrors(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (!this.input.name) errors.name = t("prep.name_required");
    if (!this.draft.day || !this.draft.month) errors.startsOn = t("season.start_required");
    return errors;
  }
  private refusalField(): Field | undefined {
    const params = this.refusal?.params;
    if (this.refusal?.code !== "season.invalid" || params?.reason === "end_offset")
      return undefined;
    return params?.field === "name" || params?.field === "startsOn" ? params.field : undefined;
  }
  private error(field: Field): string {
    if (this.refusalField() === field) {
      const taken = this.refusal?.params?.reason === "taken";
      if (field === "name") return t(taken ? "season.name_taken" : "prep.name_required");
      return t(taken ? "season.start_taken" : "season.start_required");
    }
    return this.attempted ? (this.ownErrors[field] ?? "") : "";
  }
  /** A refusal that names no field on this form, worded for beside the action. */
  private refusalText(): string {
    const refusal = this.refusal;
    if (this.impactFailed) return t("venue.delete_load_error");
    if (!refusal || this.refusalField() !== undefined) return "";
    const params = refusal.params ?? {};
    if (refusal.code === "hours.clock_changed") return t("hours.clock_changed");
    if (refusal.code === "season.not_found") return t("season.not_found");
    if (refusal.code !== "season.invalid") return t("prep.save_error");
    if (params.reason === "last") return t("season.last");
    if (params.reason !== "end_offset") return t("prep.save_error");
    if (isLocalDate(params.date)) {
      const date = formatDate(params.date as LocalDate);
      const day = this.specialDays.find((entry) => entry.id === params.specialDayId);
      return day
        ? format("season.offset_day", { name: day.name, date })
        : format("season.offset_date", { date });
    }
    const season = this.seasons.find((entry) => entry.id === params.seasonId);
    const weekday = Number(params.weekday);
    if (season && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)
      return format("season.offset_season", {
        season: season.name,
        weekday: t(`hours.day_in_sentence.${weekday}` as Parameters<typeof t>[0]),
      });
    return t("prep.save_error");
  }
  private change(next: Draft, field: Field) {
    this.draft = next;
    if (this.refusalField() === field) this.refusal = undefined;
    this.scope?.changed();
  }
  private save() {
    if (!this.open || !this.isConnected || this.busy || saveActionState(this.scope).unchanged)
      return;
    this.attempted = true;
    this.refusal = undefined;
    if (Object.keys(this.ownErrors).length) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.emit("season-save", { id: this.season?.id ?? null, input: this.input });
  }
  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.isConnected || this.busy) return false;
    if (!this.scope || !this.leave) return true;
    const generation = this.generation;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.isConnected && generation === this.generation && outcome === "proceeded";
  };
  /** The season whose days a deleted season's days join: the one starting before it. */
  private previous(season: Season): Season {
    const sorted = [...this.seasons].sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1));
    const index = sorted.findIndex((entry) => entry.id === season.id);
    return sorted.at(index - 1)!;
  }
  private confirmation(current: () => boolean) {
    const season = this.season!;
    const departments = this.confirmDelete!.departments.map((entry) => entry.name);
    const refused = this.refusalText();
    return html`<div class="form">
        <p data-test="delete-confirm-text">
          ${format("season.delete_question", { name: season.name, previous: this.previous(season).name })}
          ${
            departments.length
              ? format("season.delete_loses", {
                  departments: new Intl.ListFormat(currentLocale(), {
                    style: "long",
                    type: "conjunction",
                  }).format(departments),
                })
              : t("season.delete_loses_none")
          }
        </p>
        ${refused ? html`<p class="error" role="alert" data-error="delete">${refused}</p>` : nothing}
      </div>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          data-test="cancel-delete-season"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => {
            if (current()) this.emit("season-delete-cancel");
          }}
          >${t("season.back")}</wt-button
        >
        <wt-button
          data-test="confirm-delete-season"
          variant="danger"
          ?disabled=${this.busy}
          ?loading=${this.pending === "delete"}
          @click=${() => {
            if (current()) this.emit("season-delete-confirm", { id: season.id });
          }}
          >${t("prep.delete")}</wt-button
        >
      </wt-form-actions>`;
  }
  private dayOptions() {
    const count = this.draft.month ? daysIn(this.draft.month) : 31;
    return Array.from({ length: count }, (_, index) => ({
      value: String(index + 1),
      label: String(index + 1),
    }));
  }
  private form(current: () => boolean) {
    const action = saveActionState(this.scope);
    const startError = this.error("startsOn");
    return html`<div class="form">
        <wt-input
          name="name"
          label=${t("prep.name")}
          required
          .value=${this.draft.name}
          .error=${this.error("name")}
          ?disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (current()) this.change({ ...this.draft, name: event.detail.value }, "name");
          }}
        ></wt-input>
        <fieldset aria-describedby=${startError ? "start-error" : nothing}>
          <legend>${t("season.starts")}<span class="required" aria-hidden="true">*</span></legend>
          <div class="start">
            <wt-combobox
              name="startDay"
              label=${t("season.day")}
              search="never"
              ?invalid=${startError !== ""}
              .value=${this.draft.day}
              .options=${this.dayOptions()}
              ?disabled=${this.busy}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                if (current()) this.change({ ...this.draft, day: event.detail.value }, "startsOn");
              }}
            ></wt-combobox>
            <wt-combobox
              name="startMonth"
              label=${t("season.month")}
              search="never"
              ?invalid=${startError !== ""}
              .value=${this.draft.month}
              .options=${MONTHS.map((month) => ({ value: month, label: formatMonthName(Number(month)) }))}
              ?disabled=${this.busy}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                if (!current()) return;
                const month = event.detail.value;
                const day =
                  this.draft.day && Number(this.draft.day) > daysIn(month)
                    ? String(daysIn(month))
                    : this.draft.day;
                this.change({ ...this.draft, day, month }, "startsOn");
              }}
            ></wt-combobox>
          </div>
          ${startError ? html`<p class="error" role="alert" id="start-error" data-error="startsOn">${startError}</p>` : nothing}
        </fieldset>
        ${
          this.season && this.seasons.length > 1
            ? html`<div>
                <wt-button
                  data-test="delete-season"
                  variant="secondary"
                  ?disabled=${this.busy}
                  ?loading=${this.pending === "impact"}
                  @click=${() => {
                    if (current()) this.emit("season-delete", { id: this.season!.id });
                  }}
                  >${t("season.delete")}</wt-button
                >
              </div>`
            : nothing
        }
      </div>
      <wt-form-actions
        slot="footer"
        .error=${[this.refusalText(), fields.some((field) => this.error(field)) ? t("prep.fix_fields") : ""].filter(Boolean).join(" ")}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => {
            if (current()) void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
          }}
          >${t("prep.cancel")}</wt-button
        >
        <wt-button
          data-test="save-season"
          variant=${action.variant}
          ?disabled=${action.unchanged || this.busy || (this.attempted && Object.keys(this.ownErrors).length > 0)}
          ?loading=${this.pending === "save"}
          @click=${() => {
            if (current()) this.save();
          }}
          >${t("prep.save")}</wt-button
        >
      </wt-form-actions>`;
  }
  override render(): unknown {
    if (!this.open) return nothing;
    const generation = this.generation;
    const current = () =>
      this.isConnected && this.open && !this.busy && generation === this.generation;
    const confirming = this.season !== undefined && this.confirmDelete !== undefined;
    return keyed(
      generation,
      html`<wt-modal
        open
        size="compact"
        heading=${t(confirming ? "season.delete" : this.season ? "season.edit" : "season.new")}
        .dismissible=${!this.busy}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (current()) {
            this.open = false;
            this.emit("season-close");
          }
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (current() && !confirming)
            submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-season]"));
        }}
      >
        ${confirming ? this.confirmation(current) : this.form(current)}
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "season-dialog": SeasonDialog;
  }
}
