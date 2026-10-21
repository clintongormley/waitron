import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { businessDayBoundaryAt, businessDayBounds, cutoverForBusinessDay } from "@waitron/shared";
import {
  dateTimeFormat,
  formatBusinessDate,
  formatChangeoverMoment,
  formatDayLength,
} from "@waitron/dashboard-kit";
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
  BusinessDayStartPreview,
} from "../api/client.js";
import { t, fill } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { settingsCard, settingsCardStyles, settingsRows } from "../widgets/settings-card.js";

type Draft = { dayCutover: string };
type Waiting = { effectiveBusinessDay: string; dayCutover: string; startsAt: string };
// A longer setTimeout delay fires at once: measured 2026-10-18 in HeadlessChrome 156, 2_147_483_648 ms
// fired within 200 ms and 2_147_483_647 ms did not.
const LONGEST_TIMER_MS = 2_147_483_647;
const DAY_MS = 86_400_000;
@customElement("dashboard-business-day-start-editor")
export class BusinessDayStartEditor extends LitElement {
  static override styles = [
    baseStyles,
    settingsCardStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
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
      .day-length {
        display: block;
        color: var(--wt-color-text-muted);
      }
      .preview p {
        margin: 0 0 var(--wt-space-2);
      }
      .history {
        color: var(--wt-color-text-muted);
      }
      .preview a {
        color: var(--wt-color-primary-text);
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
  #baseline?: Draft;
  #revision = 0;
  #clockIdentity = "";
  #previewIdentity = "";
  #previewRefusal = "";
  #sequence = 0;
  #generation = 0;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #changeoverTimer?: ReturnType<typeof setTimeout>;
  #rereadPassed?: string;
  override connectedCallback(): void {
    super.connectedCallback();
    this.#generation++;
    this.#register();
    this.#scheduleReread();
  }
  override disconnectedCallback(): void {
    this.#clearReread();
    this.#generation++;
    this.#sequence++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.busy = false;
    this.preview = undefined;
    super.disconnectedCallback();
  }
  protected override willUpdate(changes: PropertyValues): void {
    if (changes.has("model") && this.draft && this.#clockIdentity !== this.#identity()) {
      this.#sequence++;
      this.preview = undefined;
      if (!this.actionError || this.actionError === this.#previewRefusal) {
        if (this.#previewRefusal && this.errors.dayCutover === this.#previewRefusal)
          this.errors = {};
        this.#previewRefusal = "";
        this.actionError = t("business_day.changed");
      }
    }
    if (changes.has("readOnly") && this.readOnly) {
      this.#sequence++;
      this.preview = undefined;
    }
  }
  protected override updated(changes: PropertyValues): void {
    if (changes.has("model")) this.#scheduleReread();
  }
  #waiting(): Waiting[] {
    const model = this.model;
    const today = model?.currentBusinessDay;
    if (!today) return [];
    return model.clock.cutoverChanges
      .filter((change) => change.effectiveBusinessDay > today)
      .map((change) => ({
        effectiveBusinessDay: change.effectiveBusinessDay,
        dayCutover: change.dayCutover.slice(0, 5),
        startsAt: businessDayBoundaryAt(model.clock, change.effectiveBusinessDay),
      }));
  }
  #clearReread(): void {
    clearTimeout(this.#changeoverTimer);
    this.#changeoverTimer = undefined;
  }
  // The panel's live query reads this table through the background client, so the re-read is passive.
  #scheduleReread(): void {
    this.#clearReread();
    const next = this.isConnected ? this.#waiting()[0] : undefined;
    if (!next) return;
    const delay = Date.parse(next.startsAt) - Date.now();
    if (delay <= 0) {
      // A model read just before the changeover can arrive after it; remembering the changeover
      // keeps a model still stale after that re-read from asking again.
      if (this.#rereadPassed === next.startsAt) return;
      this.#rereadPassed = next.startsAt;
      this.api.liveData.invalidate([{ type: "location_day_cutover_changes" }]);
      return;
    }
    if (delay > LONGEST_TIMER_MS) return;
    this.#changeoverTimer = setTimeout(() => {
      this.#changeoverTimer = undefined;
      this.api.liveData.invalidate([{ type: "location_day_cutover_changes" }]);
    }, delay);
  }
  #newStart(change: Waiting) {
    const day = new Date(Date.parse(`${change.effectiveBusinessDay}T00:00:00.000Z`) - DAY_MS)
      .toISOString()
      .slice(0, 10);
    const { startAt, endAt } = businessDayBounds(this.model.clock, day);
    return html`<span data-test="new-start-value"
        >${fill("business_day.new_start_value", {
          time: change.dayCutover,
          when: formatChangeoverMoment(change.startsAt, this.model.clock.timeZone),
        })}</span
      ><span class="day-length" data-test="day-length"
        >${fill("business_day.day_length", {
          day: formatBusinessDate(day),
          duration: formatDayLength((Date.parse(endAt) - Date.parse(startAt)) / 60_000),
        })}</span
      >`;
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
      equal: (a, b) => a.dayCutover === b.dayCutover,
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
    if (this.readOnly || this.busy) return;
    this.#generation++;
    this.#revision = this.model.revision;
    this.#clockIdentity = this.#identity();
    this.#baseline = { dayCutover: this.#waiting().at(-1)?.dayCutover ?? this.#inForce() };
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
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(this.draft!.dayCutover))
      errors.dayCutover = t("venue_details.cutover");
    return errors;
  }
  #key(): string {
    return JSON.stringify([this.draft?.dayCutover, this.#revision, this.#clockIdentity]);
  }
  #ready(): boolean {
    return (
      !!this.preview &&
      this.#previewIdentity === this.#key() &&
      this.#clockIdentity === this.#identity() &&
      this.preview.revision === this.#revision &&
      this.preview.effectiveDay.dayCutover.slice(0, 5) === this.draft?.dayCutover &&
      this.preview.conflictCount === 0
    );
  }
  #inForce(): string {
    const model = this.model;
    return (
      model.currentBusinessDay
        ? cutoverForBusinessDay(model.clock, model.currentBusinessDay)
        : model.clock.dayCutover
    ).slice(0, 5);
  }
  #refreshPreview(): void {
    const sequence = ++this.#sequence;
    this.preview = undefined;
    this.previewError = "";
    if (this.#previewRefusal && this.actionError === this.#previewRefusal) this.actionError = "";
    this.#previewRefusal = "";
    if (
      !this.draft ||
      this.readOnly ||
      Object.keys(this.#problems()).length ||
      this.draft.dayCutover === this.#baseline?.dayCutover ||
      this.#clockIdentity !== this.#identity()
    )
      return;
    const identity = this.#key();
    void this.api
      .previewBusinessDayStart({
        dayCutover: this.draft.dayCutover,
        expectedClockRevision: this.#revision,
      })
      .then((preview) => {
        if (sequence !== this.#sequence || !this.isConnected) return;
        this.#previewIdentity = identity;
        this.preview = preview;
      })
      .catch((error: unknown) => {
        if (sequence !== this.#sequence || !this.isConnected) return;
        const message = this.#refusal(error);
        if (this.#params(error)?.field !== "dayCutover") {
          this.previewError = message;
          return;
        }
        this.#previewRefusal = message;
        this.errors = { dayCutover: message };
        this.actionError = message;
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
    if (!this.#ready()) return;
    const generation = this.#generation;
    this.busy = true;
    this.actionError = "";
    try {
      const result = await this.api.putBusinessDayStart({
        effectiveBusinessDay: this.preview!.effectiveDay.businessDay,
        dayCutover: this.draft.dayCutover,
        expectedClockRevision: this.#revision,
      });
      if (generation !== this.#generation || !this.isConnected) return;
      this.#close();
      this.dispatchEvent(
        new CustomEvent("saved", { detail: result.model, bubbles: true, composed: true }),
      );
    } catch (error) {
      if (generation !== this.#generation || !this.isConnected) return;
      const code = codeOf(error);
      const params = this.#params(error);
      const message = this.#refusal(error);
      if (params?.field === "dayCutover") this.errors = { dayCutover: message };
      this.actionError = message;
      if (code === "venue.business_day_changed" || code === "venue.business_day_locked") {
        this.preview = undefined;
      }
      if (params?.reason === "changeover_passed") this.#refreshPreview();
    } finally {
      if (generation === this.#generation || !this.draft) this.busy = false;
    }
  }
  #params(error: unknown): Record<string, unknown> | undefined {
    return typeof error === "object" && error !== null
      ? (error as { params?: Record<string, unknown> }).params
      : undefined;
  }
  #refusal(error: unknown): string {
    const code = codeOf(error);
    const params = this.#params(error);
    if (code === "venue.business_day_invalid" && params?.reason === "changeover_passed")
      return t("business_day.changeover_passed");
    if (
      code === "venue.business_day_invalid" &&
      params?.reason === "clock_transition" &&
      typeof params.clocksChangeOn === "string" &&
      typeof params.saveFrom === "string"
    )
      return fill("business_day.clock_transition", {
        date: formatBusinessDate(params.clocksChangeOn),
        when: formatChangeoverMoment(params.saveFrom, this.model.clock.timeZone),
      });
    return codeMessage(code);
  }
  #clockTime(at: string): string {
    return dateTimeFormat("en-GB", {
      timeZone: this.model.clock.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(at));
  }
  #previewLines(preview: BusinessDayStartPreview) {
    const [before, after] = t("business_day.takes_effect").split("{when}");
    const day = preview.previousDay;
    const runs = {
      day: formatBusinessDate(day.businessDay),
      start: this.#clockTime(day.startAt),
      end: this.#clockTime(day.endAt),
      duration: formatDayLength((Date.parse(day.endAt) - Date.parse(day.startAt)) / 60_000),
    };
    return html`<p data-test="takes-effect">
        ${before}<strong>${formatChangeoverMoment(preview.effectiveDay.startAt, this.model.clock.timeZone)}</strong>${after}
      </p>
      <p data-test="day-runs">
        ${
          day.businessDay === this.model.currentBusinessDay
            ? fill("business_day.today_runs", runs)
            : fill("business_day.day_runs", runs)
        }
      </p>
      <p class="history">${t("business_day.history")}</p>`;
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
    const key = (
      {
        range: "business_day.conflict_range",
        endpoint_day: "business_day.conflict_endpoint",
        all_day: "business_day.conflict_all_day",
        transition_strip: "business_day.conflict_strip",
        overlap: "business_day.conflict_overlap",
        kept_open: "business_day.conflict_kept_open",
      } as const
    )[conflict.reason];
    const reason =
      conflict.reason === "kept_open" ? fill(key, { time: conflict.endsAt ?? "" }) : t(key);
    const line = [
      conflict.departmentName ?? conflict.departmentId,
      conflict.zoneName ?? conflict.zoneId,
      conflict.date ?? weekday,
      conflict.periodName ?? conflict.periodId,
      conflict.startsAt && conflict.endsAt ? `${conflict.startsAt}–${conflict.endsAt}` : undefined,
      reason,
    ]
      .filter(Boolean)
      .join(" · ");
    if (conflict.specialDayName !== undefined)
      return fill("business_day.conflict_on_special_day", { name: conflict.specialDayName, line });
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
    const draft = this.draft;
    const generation = this.#generation;
    const active = () => this.isConnected && generation === this.#generation;
    const saveAction = saveActionState(this.#scope);
    const ready = this.#ready();
    const preview = this.preview;
    const conflicts = preview && this.#conflictLines(preview);
    const action =
      !this.readOnly && !draft
        ? html`<div class="actions">
            <wt-button
              data-test="change"
              ?disabled=${this.busy}
              @click=${() => {
                if (active()) this.#begin();
              }}
              >${t("business_day.change")}</wt-button
            >
          </div>`
        : nothing;
    return html`${settingsCard({
        id: "business-day-card",
        heading: t("venue_settings.card.business_day"),
        editing: false,
        action,
        body: settingsRows([
          {
            label: t("business_day.starts_at"),
            value: this.#inForce(),
            dataTest: "saved-dayCutover",
          },
          ...this.#waiting().map((change) => ({
            label: t("business_day.new_start"),
            value: this.#newStart(change),
            dataTest: "saved-new-start",
          })),
        ]),
      })}
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
                  ${
                    preview
                      ? html`<div class="preview" data-test="preview">
                          ${this.#previewLines(preview)}
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
                </form>
                <wt-form-actions slot="footer" .error=${this.actionError}
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
                    variant=${ready ? saveAction.variant : "secondary"}
                    ?disabled=${saveAction.unchanged || this.busy || this.readOnly || !ready || (this.attempted && Object.keys(this.#problems()).length > 0)}
                    @click=${() => {
                      if (active()) void this.#save();
                    }}
                    >${t("action.save")}</wt-button
                  ></wt-form-actions
                >`
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
