import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { cutoverForBusinessDay } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type {
  DashboardApi,
  BusinessDayClockModel,
  BusinessDayStartInput,
  BusinessDayStartPreview,
} from "../api/client.js";
import { t, fill, currentLocale } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

type Draft = { effectiveBusinessDay: string; dayCutover: string };
@customElement("dashboard-business-day-start-editor")
export class BusinessDayStartEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        margin-top: var(--wt-space-4);
      }
      form,
      dl {
        display: grid;
        gap: var(--wt-space-3);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      dt {
        font-weight: var(--wt-font-weight-medium);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .preview {
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) model!: BusinessDayClockModel;
  @property({ attribute: false }) readOnly = false;
  @state() private draft?: Draft;
  @state() private preview?: BusinessDayStartPreview;
  @state() private busy = false;
  @state() private attempted = false;
  @state() private errors: Partial<Record<keyof Draft, string>> = {};
  @state() private actionError = "";
  @state() private previewError = "";
  @state() private acknowledged = "";
  #baseline?: Draft;
  #revision = 0;
  #clockIdentity = "";
  #previewIdentity = "";
  #sequence = 0;
  #generation = 0;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  override connectedCallback(): void {
    super.connectedCallback();
    this.#generation++;
    this.#register();
  }
  override disconnectedCallback(): void {
    this.#generation++;
    this.#sequence++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.busy = false;
    this.preview = undefined;
    this.acknowledged = "";
    super.disconnectedCallback();
  }
  protected override willUpdate(changes: PropertyValues): void {
    if (changes.has("model") && this.draft && this.#clockIdentity !== this.#identity()) {
      this.#sequence++;
      this.preview = undefined;
      this.acknowledged = "";
      if (!this.actionError) this.actionError = t("business_day.changed");
    }
    if (changes.has("readOnly") && this.readOnly) {
      this.#sequence++;
      this.preview = undefined;
      this.acknowledged = "";
    }
  }
  #identity(): string {
    return JSON.stringify([this.model.revision, this.model.clock, this.model.pending]);
  }
  #register(): void {
    if (!this.isConnected || !this.draft || !this.#baseline || this.#scope) return;
    const { scope, coordinator } = draftScopeFor<Draft>(this, {
      id: this,
      current: () => this.draft!,
      snapshot: (value) => ({ ...value }),
      equal: (a, b) =>
        a.effectiveBusinessDay === b.effectiveBusinessDay && a.dayCutover === b.dayCutover,
      restore: (value) => {
        this.draft = value;
        this.errors = {};
        this.actionError = "";
        this.attempted = false;
        this.#refreshPreview();
      },
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit(this.#baseline);
  }
  #begin(): void {
    if (this.readOnly || this.busy || this.model.pending?.editable === false) return;
    this.#generation++;
    this.#revision = this.model.revision;
    this.#clockIdentity = this.#identity();
    this.#baseline = {
      effectiveBusinessDay: this.model.pending?.effectiveBusinessDay ?? "",
      dayCutover: this.model.pending?.dayCutover.slice(0, 5) ?? "",
    };
    this.draft = { ...this.#baseline };
    this.actionError = "";
    this.errors = {};
    this.attempted = false;
    this.#register();
    this.#refreshPreview();
  }
  #close(): void {
    this.#generation++;
    this.#sequence++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.draft = undefined;
    this.#baseline = undefined;
    this.preview = undefined;
    this.acknowledged = "";
    this.actionError = "";
    this.errors = {};
  }
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy || !this.isConnected) return false;
    const scope = this.#scope;
    if (!scope || !this.#leave) return true;
    const decision = await this.#leave.request({ scopes: [this], reason, proceed() {} });
    return decision === "proceeded" && this.isConnected && this.#scope === scope;
  };
  #cancel(): void {
    if (!this.busy) void this.shadowRoot?.querySelector("wt-dialog")?.requestClose("cancel");
  }
  #problems(): Partial<Record<keyof Draft, string>> {
    const errors: Partial<Record<keyof Draft, string>> = {};
    const draft = this.draft!;
    const date = draft.effectiveBusinessDay;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
    )
      errors.effectiveBusinessDay = t("business_day.date_invalid");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.dayCutover))
      errors.dayCutover = t("venue_details.cutover");
    return errors;
  }
  #key(): string {
    return JSON.stringify([
      this.draft?.effectiveBusinessDay,
      this.draft?.dayCutover,
      this.#revision,
      this.#clockIdentity,
    ]);
  }
  #ready(): boolean {
    return (
      !!this.preview &&
      this.#previewIdentity === this.#key() &&
      this.#clockIdentity === this.#identity() &&
      this.preview.revision === this.#revision &&
      this.preview.effectiveDay.businessDay === this.draft?.effectiveBusinessDay &&
      this.preview.effectiveDay.dayCutover.slice(0, 5) === this.draft?.dayCutover &&
      this.preview.conflictCount === 0
    );
  }
  #input(): BusinessDayStartInput {
    return { ...this.draft!, expectedClockRevision: this.#revision };
  }
  #refreshPreview(): void {
    const sequence = ++this.#sequence;
    this.preview = undefined;
    this.previewError = "";
    this.acknowledged = "";
    if (
      !this.draft ||
      this.readOnly ||
      Object.keys(this.#problems()).length ||
      this.#clockIdentity !== this.#identity()
    )
      return;
    const identity = this.#key();
    const input = this.#input();
    void this.api
      .previewBusinessDayStart(input)
      .then((preview) => {
        if (sequence !== this.#sequence || !this.isConnected) return;
        this.#previewIdentity = identity;
        this.preview = preview;
      })
      .catch((error: unknown) => {
        if (sequence === this.#sequence && this.isConnected)
          this.previewError = codeMessage(codeOf(error));
      });
  }
  #change(field: keyof Draft, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.draft || this.busy || this.readOnly) return;
    this.draft = { ...this.draft, [field]: event.detail.value };
    this.#scope?.changed();
    this.errors = this.attempted ? this.#problems() : {};
    if (this.actionError === t("form.fix_fields") && !Object.keys(this.errors).length)
      this.actionError = "";
    this.#refreshPreview();
  }
  async #save(): Promise<void> {
    if (!this.draft || this.busy || this.readOnly || saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.errors = this.#problems();
    if (Object.keys(this.errors).length) {
      this.actionError = t("form.fix_fields");
      return;
    }
    if (!this.#ready() || this.acknowledged !== this.#key()) return;
    const generation = this.#generation;
    this.busy = true;
    this.actionError = "";
    try {
      const result = await this.api.putBusinessDayStart(this.#input());
      if (generation !== this.#generation || !this.isConnected) return;
      this.#close();
      this.dispatchEvent(
        new CustomEvent("saved", { detail: result.model, bubbles: true, composed: true }),
      );
    } catch (error) {
      if (generation !== this.#generation || !this.isConnected) return;
      const params =
        typeof error === "object" && error !== null
          ? (error as { params?: Record<string, unknown> }).params
          : undefined;
      const code = codeOf(error);
      const message = codeMessage(code);
      const field = params?.field;
      if (field === "effectiveBusinessDay" || field === "dayCutover")
        this.errors = { [field]: message };
      this.actionError = message;
      if (code === "venue.business_day_changed" || code === "venue.business_day_locked") {
        this.preview = undefined;
        this.acknowledged = "";
      }
    } finally {
      if (generation === this.#generation || !this.draft) this.busy = false;
    }
  }
  async #cancelPending(): Promise<void> {
    if (this.readOnly || this.busy || !this.model.pending?.editable) return;
    const generation = this.#generation;
    const revision = this.model.revision;
    this.busy = true;
    this.actionError = "";
    try {
      const result = await this.api.cancelBusinessDayStart({ expectedClockRevision: revision });
      if (generation !== this.#generation || !this.isConnected) return;
      this.dispatchEvent(
        new CustomEvent("saved", { detail: result.model, bubbles: true, composed: true }),
      );
    } catch (error) {
      if (generation === this.#generation && this.isConnected)
        this.actionError = codeMessage(codeOf(error));
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  #instant(at: string) {
    return html`<time datetime=${at}
      >${new Intl.DateTimeFormat(currentLocale(), {
        timeZone: this.model.clock.timeZone,
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short",
      }).format(new Date(at))}</time
    >`;
  }
  #conflict(conflict: BusinessDayStartPreview["conflicts"][number]): string {
    const weekday =
      conflict.weekday === undefined
        ? undefined
        : t(
            (
              [
                "backup.weekday.mon",
                "backup.weekday.tue",
                "backup.weekday.wed",
                "backup.weekday.thu",
                "backup.weekday.fri",
                "backup.weekday.sat",
                "backup.weekday.sun",
              ] as const
            )[(conflict.weekday + 6) % 7]!,
          );
    const reason = t(
      (
        {
          range: "business_day.conflict_range",
          endpoint_day: "business_day.conflict_endpoint",
          all_day: "business_day.conflict_all_day",
          sending_cutoff: "business_day.conflict_sending",
          transition_strip: "business_day.conflict_strip",
        } as const
      )[conflict.reason],
    );
    const line = [
      conflict.departmentName ?? conflict.departmentId,
      conflict.zoneName ?? conflict.zoneId,
      conflict.specialDateName ?? conflict.specialDateId,
      conflict.date ?? weekday,
      conflict.periodName ?? conflict.periodId,
      conflict.startsAt && conflict.endsAt ? `${conflict.startsAt}–${conflict.endsAt}` : undefined,
      reason,
    ]
      .filter(Boolean)
      .join(" · ");
    return conflict.seasonName === undefined
      ? line
      : fill("business_day.conflict_in_season", { season: conflict.seasonName, line });
  }
  #conflictLines(preview: BusinessDayStartPreview): { lines: string[]; count: number } {
    const lines = [...new Set(preview.conflicts.map((conflict) => this.#conflict(conflict)))];
    // The server counts conflicts with the season set aside and lists only the first few; what it
    // counted beyond the list is added to the lines shown.
    const listed = new Set(
      preview.conflicts.map((conflict) =>
        JSON.stringify({ ...conflict, seasonId: undefined, seasonName: undefined }),
      ),
    ).size;
    return { lines, count: lines.length + Math.max(0, preview.conflictCount - listed) };
  }
  override render() {
    const model = this.model;
    if (!model) return nothing;
    const current = model.currentBusinessDay
      ? cutoverForBusinessDay(model.clock, model.currentBusinessDay)
      : model.clock.dayCutover;
    const pending = model.pending;
    const draft = this.draft;
    const generation = this.#generation;
    const active = () => this.isConnected && generation === this.#generation;
    const action = saveActionState(this.#scope);
    const ready = this.#ready();
    const preview = this.preview;
    const conflicts = preview && this.#conflictLines(preview);
    return html`<h3>${t("business_day.title")}</h3>
      <dl>
        <dt>${t("business_day.current")}</dt>
        <dd>${current.slice(0, 5)} (${model.clock.timeZone})</dd>
        ${
          pending
            ? html`<dt>${t("business_day.pending")}</dt>
                <dd>${pending.effectiveBusinessDay} · ${pending.dayCutover.slice(0, 5)}</dd>
                <dt>${t("business_day.locks")}</dt>
                <dd>${this.#instant(pending.locksAt)}</dd>`
            : nothing
        }
      </dl>
      ${pending?.editable === false ? html`<p data-test="locked">${t("business_day.locked")}</p>` : nothing}
      ${
        !this.readOnly && !draft && pending?.editable !== false
          ? html`<wt-button
                data-test=${pending ? "replace" : "change"}
                ?disabled=${this.busy}
                @click=${() => {
                  if (active()) this.#begin();
                }}
                >${t(pending ? "business_day.replace" : "business_day.change")}</wt-button
              >${
                pending
                  ? html`<wt-button
                      data-test="cancel-pending"
                      ?disabled=${this.busy}
                      @click=${() => {
                        if (active()) void this.#cancelPending();
                      }}
                      >${t("business_day.cancel_pending")}</wt-button
                    >`
                  : nothing
              }`
          : nothing
      }
      ${this.actionError && !draft ? html`<p class="error" role="alert">${this.actionError}</p>` : nothing}
      <wt-dialog
        .open=${!!draft}
        .dismissible=${!this.busy}
        .beforeClose=${this.#beforeClose}
        heading=${t("business_day.title")}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (active() && this.draft) this.#close();
        }}
      >
        ${
          draft
            ? html`<form
                @submit=${(event: Event) => {
                  event.preventDefault();
                  if (active()) void this.#save();
                }}
              >
                <wt-input
                  name="effectiveBusinessDay"
                  label=${t("business_day.date")}
                  placeholder="YYYY-MM-DD"
                  required
                  .value=${draft.effectiveBusinessDay}
                  .error=${this.errors.effectiveBusinessDay ?? ""}
                  ?disabled=${this.busy || this.readOnly}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    if (active()) this.#change("effectiveBusinessDay", event);
                  }}
                ></wt-input>
                <wt-input
                  name="dayCutover"
                  label=${t("venue_details.dayCutover")}
                  placeholder="HH:MM"
                  required
                  .value=${draft.dayCutover}
                  .error=${this.errors.dayCutover ?? ""}
                  ?disabled=${this.busy || this.readOnly}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    if (active()) this.#change("dayCutover", event);
                  }}
                ></wt-input>
                <p>${t("business_day.history")}</p>
                ${
                  preview
                    ? html`<div class="preview" data-test="preview">
                        <p>
                          ${t("business_day.transition")}
                          ${String((Date.parse(preview.previousDay.endAt) - Date.parse(preview.previousDay.startAt)) / 3600000)}
                          h
                        </p>
                        <dl>
                          <dt>${preview.previousDay.businessDay}</dt>
                          <dd>
                            ${this.#instant(preview.previousDay.startAt)} →
                            ${this.#instant(preview.previousDay.endAt)}
                          </dd>
                          <dt>${preview.effectiveDay.businessDay}</dt>
                          <dd>
                            ${this.#instant(preview.effectiveDay.startAt)} →
                            ${this.#instant(preview.effectiveDay.endAt)}
                          </dd>
                          <dt>${t("business_day.locks")}</dt>
                          <dd>${this.#instant(preview.locksAt)}</dd>
                        </dl>
                        ${
                          preview.conflictCount
                            ? html`<p data-test="conflicts">
                                  ${t("business_day.conflicts")} ${conflicts!.count}.
                                  <a href="/manage/opening-hours"
                                    >${t("business_day.open_hours")}</a
                                  >
                                </p>
                                <ul data-test="conflict-rows">
                                  ${conflicts!.lines.map((line) => html`<li>${line}</li>`)}
                                </ul>`
                            : nothing
                        }
                      </div>`
                    : nothing
                }
                ${
                  this.previewError
                    ? html`<p role="alert" class="error">${this.previewError}</p>
                        <wt-button
                          data-test="preview-retry"
                          @click=${() => {
                            if (active()) this.#refreshPreview();
                          }}
                          >${t("venue_details.retry_preview")}</wt-button
                        >`
                    : nothing
                }
                ${
                  ready && this.acknowledged !== this.#key()
                    ? html`<wt-button
                        data-test="acknowledge"
                        @click=${() => {
                          if (active() && this.#ready()) this.acknowledged = this.#key();
                        }}
                        >${t("business_day.acknowledge")}</wt-button
                      >`
                    : nothing
                }
                <wt-form-actions .error=${this.actionError}
                  ><wt-button
                    slot="cancel"
                    data-test="cancel"
                    ?disabled=${this.busy}
                    @click=${() => {
                      if (active()) this.#cancel();
                    }}
                    >${t("action.cancel")}</wt-button
                  ><wt-button
                    data-test="save"
                    variant=${action.variant}
                    ?disabled=${action.unchanged || this.busy || this.readOnly || !ready || this.acknowledged !== this.#key() || (this.attempted && Object.keys(this.#problems()).length > 0)}
                    @click=${() => {
                      if (active()) void this.#save();
                    }}
                    >${t("action.save")}</wt-button
                  ></wt-form-actions
                >
              </form>`
            : nothing
        }</wt-dialog
      >`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-business-day-start-editor": BusinessDayStartEditor;
  }
}
