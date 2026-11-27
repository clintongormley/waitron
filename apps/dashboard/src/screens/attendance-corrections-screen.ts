import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  QueryController,
  dateTimeFormat,
  type DashboardRequest,
  type LiveData,
} from "@waitron/dashboard-kit";
import type {
  AttendanceExportOptions,
  AttendanceChange,
  AttendanceCommand,
  AttendanceCommandResult,
  AttendanceDayView,
  AttendanceLookups,
  CorrectionItem,
  FinishedAttendanceDay,
  ManagerHours,
} from "@waitron/dashboard-modules";
import {
  baseStyles,
  draftScopeFor,
  pageTitleStyles,
  saveActionState,
  submitOnEnter,
  type DraftScope,
} from "@waitron/ui";
import { AttendanceExportApi } from "../api/attendance-export.js";
import "../widgets/attendance-export-dialog.js";
import { HoursApi } from "../api/hours.js";
import "../widgets/hours-record.js";
import { AttendanceApi } from "../api/attendance.js";
import {
  attendanceFinishedDaysStyles,
  renderAttendanceFinishedDays,
} from "./attendance-finished-days.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { wallClock } from "../date-utils.js";
import {
  hoursDate,
  hoursTime,
  periodLabel,
  periodStep,
  requestedPeriodLabel,
} from "../hours-format.js";
import { storedAttendanceTime } from "../widgets/attendance-history.js";
import "../widgets/attendance-proposal-dialog.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";

const validCloseGrace = (value: string) => /^(?:[0-9]|10)$/.test(value);

type Entry = AttendanceDayView["record"]["entries"][number]["entry"];
function statusLabel(status: CorrectionItem["status"]): string {
  switch (status) {
    case "waiting-manager":
      return t("attendance.waiting_manager");
    case "waiting-worker":
      return t("attendance.waiting_worker");
    case "approved":
      return t("attendance.approved");
    case "declined":
      return t("attendance.declined");
    case "disputed":
      return t("attendance.disputed");
    case "overtaken":
      return t("attendance.overtaken");
  }
}

@customElement("dashboard-attendance-corrections-screen")
export class AttendanceCorrectionsScreen extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    pageTitleStyles,
    attendanceFinishedDaysStyles,
    css`
      :host {
        display: block;
        color: var(--wt-color-text);
      }
      h2 {
        font-size: var(--wt-font-size-lg);
      }
      h1,
      h2,
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .screen,
      .selectors,
      section,
      article,
      ul {
        display: grid;
        gap: var(--wt-space-3);
        grid-template-columns: minmax(0, 1fr);
      }
      .selectors {
        grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--wt-form-max-width)), 1fr));
      }
      .close-grace {
        display: grid;
        max-width: var(--wt-form-max-width);
        gap: var(--wt-space-2);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .period {
        align-items: center;
      }
      section,
      article {
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      ul {
        padding-inline-start: var(--wt-space-4);
        margin: 0;
      }
      li {
        overflow-wrap: anywhere;
      }
      .error {
        color: var(--wt-color-danger);
        overflow-wrap: anywhere;
      }
      time {
        font-variant-numeric: tabular-nums;
      }
    `,
  ];
  @property() mode: "corrections" | "hours" = "corrections";
  @property({ attribute: false }) request!: DashboardRequest;
  @property({ attribute: false }) liveData?: LiveData;
  @state() private lookups: AttendanceLookups | null = null;
  @state() private personId = "";
  @state() private date = "";
  @state() private hours: ManagerHours | null = null;
  @state() private closeGraceDraft: string | null = null;
  @state() private closeGraceError = "";
  @state() private savingCloseGrace = false;
  #closeGraceScope?: DraftScope<string>;
  @state() private periodDate = "";
  @state() private periodFrom: ManagerHours["period"] | null = null;
  @state() private hoursReading = false;
  @state() private exportOptions: AttendanceExportOptions | null = null;
  @state() private exportOpen = false;
  @state() private exportError = "";
  #exportRead = 0;
  #hoursApi?: HoursApi;
  @state() private queue: CorrectionItem[] = [];
  @state() private finishedDays: FinishedAttendanceDay[] | null = null;
  @state() private view: AttendanceDayView | null = null;
  @state() private selectedItemId: string | null = null;
  @state() private reading = false;
  @state() private busy = false;
  @state() private readError = "";
  @state() private actionError = "";
  @state() private reasonRefusal = "";
  @state() private editorOpen = false;
  @state() private editorChanges: AttendanceChange[] = [];
  @state() private uncertain = false;
  @state() private retry = false;
  #api?: AttendanceApi;
  #generation = 0;
  #initialized = false;
  #actionWait?: AbortController;
  #editorRevision = "";
  #pending: AttendanceCommand | null = null;
  readonly #queries = new QueryController(
    this,
    () => this.liveData,
    (error) => {
      this.readError = codeMessage(codeOf(error));
    },
    () => {
      this.readError = "";
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback(): void {
    this.#generation++;
    this.#exportRead++;
    this.#resetCloseGrace();
    this.exportOpen = false;
    this.exportOptions = null;
    this.#actionWait?.abort();
    this.#initialized = false;
    this.#pending = null;
    this.editorOpen = false;
    this.busy = false;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues): void {
    if (
      this.isConnected &&
      (!this.#initialized ||
        changed.has("request") ||
        changed.has("liveData") ||
        changed.has("mode"))
    )
      void this.#start();
  }
  async #loadExportOptions(): Promise<void> {
    const read = ++this.#exportRead;
    const generation = this.#generation,
      request = this.request;
    this.exportOpen = false;
    this.exportOptions = null;
    this.exportError = "";
    if (this.mode !== "hours" || !request) return;
    try {
      const options = await new AttendanceExportApi(request).options();
      if (
        this.isConnected &&
        read === this.#exportRead &&
        generation === this.#generation &&
        request === this.request &&
        this.mode === "hours"
      )
        this.exportOptions = options;
    } catch (error) {
      if (this.isConnected && read === this.#exportRead && generation === this.#generation)
        this.exportError = codeMessage(codeOf(error));
    }
  }
  async #start(): Promise<void> {
    this.#initialized = true;
    this.#generation++;
    this.#resetCloseGrace();
    void this.#loadExportOptions();
    this.#actionWait?.abort();
    for (const slot of ["lookups", "queue", "day", "hours"]) this.#queries.release(slot);
    this.hours = null;
    this.periodDate = "";
    this.periodFrom = null;
    this.hoursReading = false;
    this.#hoursApi = new HoursApi(this.request, this.liveData);
    this.#api = new AttendanceApi(this.request, this.liveData);
    this.lookups = null;
    this.view = null;
    this.queue = [];
    this.finishedDays = null;
    this.personId = "";
    this.editorOpen = false;
    this.#pending = null;
    this.uncertain = false;
    this.retry = false;
    this.busy = false;
    this.readError = "";
    this.actionError = "";
    try {
      await Promise.all([
        this.#queries.watch("lookups", this.#api.lookupsQuery(), (value) => {
          const previousPerson = this.personId;
          this.lookups = value;
          if (
            !(this.hours?.people ?? value.people).some(
              (person) => person.personId === this.personId,
            )
          )
            this.personId = value.people[0]?.personId ?? "";
          if (previousPerson !== this.personId) {
            this.#queries.release("day");
            this.view = null;
            this.selectedItemId = null;
            this.reading = false;
          }
        }),
        this.#watchQueue(),
      ]);
    } catch {
      /* QueryController publishes the read's failure. */
    }
  }
  async #watchQueue(): Promise<void> {
    if (this.mode === "hours") {
      await this.#watchHours();
      return;
    }
    await this.#queries.watch("queue", this.#api!.queueQuery(), (value) => {
      this.queue = value.items;
      this.finishedDays = value.finishedDays;
    });
  }
  get #personHours() {
    return this.hours?.people.find((person) => person.personId === this.personId)?.hours;
  }
  async #watchHours(): Promise<void> {
    this.#queries.release("queue");
    const generation = this.#generation;
    const date = this.periodDate;
    this.hoursReading = true;
    try {
      await this.#queries.watch(
        "hours",
        this.#hoursApi!.managerQuery({
          kind: "pay-period",
          ...(date ? { date } : {}),
        }),
        (value) => {
          this.hours = value;
          this.periodFrom = value.period;
          this.queue = value.people.flatMap((person) => person.hours.pending.items);
          if (
            !(this.hours?.people ?? value.people).some(
              (person) => person.personId === this.personId,
            )
          ) {
            this.#queries.release("day");
            this.view = null;
            this.selectedItemId = null;
            if (!this.editorOpen) this.personId = value.people[0]?.personId ?? "";
          }
        },
      );
    } finally {
      if (generation === this.#generation && date === this.periodDate) this.hoursReading = false;
    }
  }
  #period(direction: -1 | 1): void {
    if (!this.isConnected || this.#blocked || this.editorOpen || !this.lookups) return;
    const from = this.periodFrom;
    if (!from) return;
    const step = periodStep(from, direction);
    if (!this.hours && this.periodDate === step) return;
    const date = !this.hours && this.periodDate !== from.start ? from.start : step;
    this.periodDate = date;
    this.hours = null;
    this.queue = [];
    this.#queries.release("day");
    this.view = null;
    this.selectedItemId = null;
    void this.#watchHours().catch(() => undefined);
  }
  #resetCloseGrace(): void {
    this.#closeGraceScope?.dispose();
    this.#closeGraceScope = undefined;
    this.closeGraceDraft = null;
    this.closeGraceError = "";
    this.savingCloseGrace = false;
  }
  #editCloseGrace(value: string, saved: number): void {
    if (this.closeGraceDraft === null) {
      this.#closeGraceScope?.dispose();
      const initial = String(saved);
      this.#closeGraceScope = draftScopeFor(this, {
        id: this,
        current: () => this.closeGraceDraft ?? initial,
        snapshot: (draft) => draft,
        equal: (a, b) => a === b,
        restore: () => {
          this.closeGraceDraft = null;
          this.closeGraceError = "";
        },
      }).scope;
    }
    this.closeGraceDraft = value;
    this.closeGraceError = "";
    this.#closeGraceScope?.changed();
  }
  async #saveCloseGrace(): Promise<void> {
    const draft = this.closeGraceDraft;
    const hours = this.hours;
    if (
      !hours?.monthClose?.canEdit ||
      this.#blocked ||
      this.editorOpen ||
      this.savingCloseGrace ||
      draft === null ||
      !validCloseGrace(draft) ||
      saveActionState(this.#closeGraceScope).unchanged
    )
      return;
    const api = this.#hoursApi!;
    const generation = this.#generation;
    const graceDays = Number(draft);
    this.savingCloseGrace = true;
    this.closeGraceError = "";
    try {
      await api.saveCloseGraceDays(graceDays);
    } catch (error) {
      if (generation === this.#generation) {
        this.closeGraceError = codeMessage(codeOf(error));
        this.savingCloseGrace = false;
      }
      return;
    }
    if (generation !== this.#generation) return;
    this.#closeGraceScope?.commit(draft);
    if (this.hours?.monthClose)
      this.hours = { ...this.hours, monthClose: { ...this.hours.monthClose, graceDays } };
    this.#resetCloseGrace();
    await this.#watchHours().catch(() => undefined);
  }
  #monthlyClose(disabled: boolean) {
    const hours = this.hours;
    const close = hours?.monthClose;
    if (!close) return nothing;
    const instant = close.closedAt ?? close.scheduledCloseAt;
    if (instant === null && close.holidayCoverageComplete && !close.canEdit) return nothing;
    const at =
      instant &&
      dateTimeFormat(currentLocale(), {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: close.timeZone,
      }).format(new Date(instant));
    const grace = this.closeGraceDraft ?? String(close.graceDays);
    const error = validCloseGrace(grace) ? "" : t("hours.close_grace_invalid");
    const action = saveActionState(this.#closeGraceScope);
    return html`<section data-month-close aria-label=${t("hours.month_close")}>
      ${at ? html`<p>${fill(close.closedAt ? "hours.closed_at" : "hours.closes_at", { at })}</p>` : nothing}
      ${close.holidayCoverageComplete ? nothing : html`<p>${t("hours.close_holiday_coverage")}</p>`}
      ${
        !close.canEdit
          ? nothing
          : html`<div
              class="close-grace"
              @keydown=${(event: KeyboardEvent) =>
                submitOnEnter(
                  event,
                  this.renderRoot.querySelector<HTMLElement>("[data-save-close-grace]"),
                )}
            >
              <wt-input
                name="closeGraceDays"
                type="number"
                required
                .label=${t("hours.close_grace")}
                .value=${grace}
                .error=${error}
                .disabled=${disabled || this.savingCloseGrace}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#editCloseGrace(event.detail.value, close.graceDays);
                }}
              ></wt-input>
              <wt-form-actions .error=${error ? t("form.fix_fields") : this.closeGraceError}>
                <wt-button
                  data-save-close-grace
                  variant=${action.variant}
                  .disabled=${disabled || this.savingCloseGrace || action.unchanged || !!error}
                  .loading=${this.savingCloseGrace}
                  @click=${() => void this.#saveCloseGrace()}
                  >${t("action.save")}</wt-button
                >
              </wt-form-actions>
            </div>`
      }
    </section>`;
  }
  #periodControls(disabled: boolean) {
    const from = this.periodFrom;
    const unavailable = disabled || !this.lookups || !from;
    return html`<div class="actions period" role="group" aria-label=${t("hours.window")}>
        <wt-button
          data-hours-previous
          variant="secondary"
          .disabled=${unavailable || (!this.hours && !!from && this.periodDate === periodStep(from, -1))}
          @click=${() => this.#period(-1)}
          >${t("hours.previous")}</wt-button
        >
        <span data-hours-period aria-live="polite"
          >${this.hours ? periodLabel(this.hours.period) : from ? requestedPeriodLabel(from, this.periodDate) : nothing}</span
        >
        <wt-button
          data-hours-next
          variant="secondary"
          .disabled=${unavailable || (!this.hours && !!from && this.periodDate === periodStep(from, 1))}
          @click=${() => this.#period(1)}
          >${t("hours.next")}</wt-button
        >
      </div>
      ${this.#monthlyClose(disabled)}
      <div class="actions">
        ${
          this.exportOptions?.available && this.exportOptions.canExportAll
            ? html`<wt-button
                data-export
                variant=${this.hours && !disabled ? "primary" : "secondary"}
                .disabled=${disabled || !this.hours}
                @click=${() => {
                  if (
                    this.hours &&
                    !disabled &&
                    this.isConnected &&
                    this.mode === "hours" &&
                    this.exportOptions?.available &&
                    this.exportOptions.canExportAll
                  )
                    this.exportOpen = true;
                }}
                >${t("attendance_export.heading")}</wt-button
              >`
            : nothing
        }
        <wt-button
          data-hours-refresh
          variant="secondary"
          .disabled=${this.busy}
          @click=${() => void this.#retryRead()}
          >${t("hours.refresh")}</wt-button
        >
      </div>`;
  }
  #hoursRecord(disabled: boolean) {
    const hours = this.#personHours;
    return html`${
      hours
        ? html`<section data-person-hours>
            <h2>${this.#person(this.personId)}</h2>
            <dashboard-hours-record
              .view=${hours}
              manager
              .dayActionLabel=${t("attendance.open_day")}
              .blocked=${disabled}
              @hours-day=${(event: CustomEvent<{ date: string }>) => {
                event.stopPropagation();
                if (
                  !this.isConnected ||
                  this.#blocked ||
                  this.editorOpen ||
                  this.#personHours !== hours
                )
                  return;
                this.date = event.detail.date;
                this.selectedItemId = null;
                void this.#day();
              }}
            ></dashboard-hours-record>
          </section>`
        : this.hours
          ? html`<p>${t("attendance.no_times")}</p>`
          : nothing
    }`;
  }
  #person(id: string): string {
    return (
      this.hours?.people.find((person) => person.personId === id)?.displayName ??
      this.lookups?.people.find((person) => person.personId === id)?.displayName ??
      id
    );
  }
  get #selected(): CorrectionItem | undefined {
    return this.view?.items.find((item) => item.id === this.selectedItemId);
  }
  get #blocked(): boolean {
    return this.busy || this.#pending !== null;
  }
  get #staleEditor(): boolean {
    return this.editorOpen && this.#editorRevision !== this.view?.revision;
  }
  #select(event: CustomEvent<{ value: string }>, field: "personId" | "date"): void {
    event.stopPropagation();
    if (this.#blocked || this.editorOpen || !this.isConnected) return;
    this[field] = event.detail.value;
    this.#queries.release("day");
    this.view = null;
    this.selectedItemId = null;
    this.reading = false;
  }
  async #day(): Promise<void> {
    if (!this.personId || !/^\d{4}-\d{2}-\d{2}$/.test(this.date)) return;
    const generation = this.#generation;
    const [personId, date] = [this.personId, this.date];
    this.reading = true;
    try {
      await this.#queries.watch("day", this.#api!.dayQuery(personId, date), (value) => {
        if (value.personId !== personId || value.date !== date)
          throw new TypeError("Attendance day does not match the selection");
        this.view = value;
      });
    } catch {
      /* QueryController publishes the read's failure. */
    } finally {
      if (generation === this.#generation && this.personId === personId && this.date === date)
        this.reading = false;
    }
  }
  #details(item: CorrectionItem): void {
    if (this.#blocked || this.editorOpen || !this.isConnected) return;
    this.personId = item.personId;
    this.selectedItemId = item.id;
    this.view = null;
    const change = item.changes[0]!;
    this.date = wallClock(change.at, change.offsetMinutes).date;
    void this.#day();
  }
  #edit(changes: AttendanceChange[]): void {
    if (
      !this.isConnected ||
      this.#blocked ||
      !this.view ||
      this.view.personId === this.lookups?.viewer.personId
    )
      return;
    this.#editorRevision = this.view.revision;
    this.editorChanges = structuredClone(changes);
    this.actionError = "";
    this.reasonRefusal = "";
    this.editorOpen = true;
  }
  #retime(entry: Entry): void {
    this.#edit([
      { target: { entryId: entry.entryId }, at: entry.eventAt, offsetMinutes: entry.offsetMinutes },
    ]);
  }
  #missing(kinds: ("in" | "out" | "break_start" | "break_end")[]): void {
    this.#edit(kinds.map((missingKind) => ({ target: { missingKind }, at: "", offsetMinutes: 0 })));
  }
  #canApprove(item: CorrectionItem): boolean {
    return (
      item.direction === "worker_request" &&
      item.status === "waiting-manager" &&
      item.readyToApply &&
      (item.personId !== this.lookups?.viewer.personId || this.lookups.viewer.canSelfApprove)
    );
  }
  #canDecline(item: CorrectionItem): boolean {
    return (
      item.direction === "worker_request" &&
      item.status === "waiting-manager" &&
      item.personId !== this.lookups?.viewer.personId
    );
  }
  #settle(action: "approve" | "decline"): void {
    const item = this.#selected;
    if (
      !this.isConnected ||
      !this.view ||
      this.#blocked ||
      this.editorOpen ||
      !item ||
      !(action === "approve" ? this.#canApprove(item) : this.#canDecline(item))
    )
      return;
    void this.#send({
      commandId: crypto.randomUUID(),
      expectedRevision: this.view.revision,
      action,
      itemId: item.id,
    });
  }
  #propose(event: CustomEvent<{ changes: AttendanceChange[]; reason: string }>): void {
    event.stopPropagation();
    if (
      !this.isConnected ||
      !this.editorOpen ||
      this.#blocked ||
      this.#staleEditor ||
      !this.view ||
      this.view.personId === this.lookups?.viewer.personId
    )
      return;
    void this.#send({
      action: "propose",
      commandId: crypto.randomUUID(),
      expectedRevision: this.#editorRevision,
      personId: this.view.personId,
      ...event.detail,
    });
  }
  async #refresh(): Promise<void> {
    await Promise.allSettled([this.#watchQueue(), this.#day()]);
  }
  #approveDays = async (days: FinishedAttendanceDay[]): Promise<void> => {
    if (!this.isConnected || this.#blocked || this.editorOpen || this.readError) return;
    const generation = this.#generation;
    this.busy = true;
    this.actionError = "";
    try {
      await this.#api!.approveDays(
        days.map(({ personId, date, digest }) => ({ personId, date, digest })),
      );
    } catch (error) {
      if (generation !== this.#generation) return;
      const code = codeOf(error);
      this.actionError =
        code === "attendance.state_changed"
          ? t("attendance.finished_days_changed")
          : codeMessage(code);
    }
    if (generation !== this.#generation) return;
    if (this.view) await this.#refresh();
    else await this.#watchQueue().catch(() => undefined);
    if (generation === this.#generation) this.busy = false;
  };
  async #saved(result: AttendanceCommandResult, command: AttendanceCommand): Promise<void> {
    if (result.commandId !== command.commandId)
      throw new TypeError("Attendance result belongs to another command");
    this.#pending = null;
    this.uncertain = false;
    this.retry = false;
    this.editorOpen = false;
    this.actionError = "";
    this.reasonRefusal = "";
    await this.updateComplete;
    await this.#refresh();
  }
  async #awaitCommand(
    operation: Promise<AttendanceCommandResult>,
  ): Promise<AttendanceCommandResult> {
    const controller = new AbortController();
    this.#actionWait = controller;
    const timeout = setTimeout(() => controller.abort(), 25_000);
    let onAbort!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject({ code: "connection.timed_out" });
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([operation, stopped]);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", onAbort);
      if (this.#actionWait === controller) this.#actionWait = undefined;
    }
  }
  async #send(command: AttendanceCommand, retry = false): Promise<void> {
    if (!this.isConnected || this.busy || (this.#pending !== null && !retry)) return;
    const generation = this.#generation;
    this.busy = true;
    this.actionError = "";
    this.reasonRefusal = "";
    this.retry = false;
    try {
      const result = await this.#awaitCommand(this.#api!.send(command));
      if (generation !== this.#generation) return;
      await this.#saved(result, command);
    } catch (error) {
      if (generation !== this.#generation) return;
      const code = codeOf(error);
      const status = (error as { status?: unknown } | null)?.status;
      const knownRefusal = typeof status === "number" && status >= 400 && status < 500;
      if (!knownRefusal) {
        this.#pending = command;
        this.uncertain = true;
        await this.#recover(command);
      } else {
        this.#pending = null;
        this.uncertain = false;
        const params = (error as { params?: { field?: string } }).params;
        if (params?.field === "reason" && this.editorOpen)
          this.reasonRefusal = t("attendance.check_reason");
        else this.actionError = codeMessage(code);
      }
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  async #recover(command: AttendanceCommand): Promise<void> {
    const generation = this.#generation;
    try {
      const result = await this.#api!.background.command(command.commandId);
      if (generation !== this.#generation) return;
      if (result) await this.#saved(result, command);
      else {
        this.uncertain = false;
        this.retry = true;
        await this.#refresh();
      }
    } catch {
      if (generation === this.#generation) {
        this.uncertain = true;
        this.retry = false;
      }
    }
  }
  async #retryRead(): Promise<void> {
    if (!this.isConnected || this.busy) return;
    if (!this.lookups) {
      await this.#start();
      return;
    }
    const generation = this.#generation;
    const ownsBusy = this.#pending !== null || this.mode === "corrections";
    if (ownsBusy) this.busy = true;
    try {
      if (this.#pending) await this.#recover(this.#pending);
      else {
        await this.#refresh();
        if (this.exportError) await this.#loadExportOptions();
      }
    } finally {
      if (ownsBusy && generation === this.#generation) this.busy = false;
    }
  }
  #retryCommand(): void {
    if (this.retry && this.#pending) void this.#send(this.#pending, true);
  }
  #history(entry: Entry) {
    const author = entry.extension?.authorKind ?? "worker";
    const label =
      entry.extension?.respondsToEntryId || entry.entryKind === "confirmation"
        ? t("attendance.response")
        : entry.entryKind === "correction"
          ? t("attendance.proposed")
          : t("attendance.original");
    const timeZone = this.mode === "hours" ? this.view?.timeZone : undefined;
    const time = timeZone
      ? hoursTime(entry.eventAt, entry.offsetMinutes, timeZone, undefined, this.periodFrom?.start)
      : storedAttendanceTime(entry.eventAt, entry.offsetMinutes);
    const recordedAt = timeZone
      ? dateTimeFormat(currentLocale(), {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone,
        }).format(new Date(entry.recordedAt))
      : entry.recordedAt;
    return html`<li>
      <span data-entry-kind
        >${["in", "out", "break_start", "break_end"].includes(entry.entryKind) ? t(`clock.${entry.entryKind as "in" | "out" | "break_start" | "break_end"}`) : entry.extension?.missingEntryKind ? t(`clock.${entry.extension.missingEntryKind}`) : nothing}</span
      ><span> · ${label}: </span><time datetime=${entry.eventAt}>${time}</time>
      <p>
        ${author === "automatic" ? t("attendance.author_automatic") : this.#person(entry.recordedByPersonId ?? entry.personId)}
        · ${t("attendance.recorded")}: <time datetime=${entry.recordedAt}>${recordedAt}</time>
      </p>
      ${entry.correctionReason ? html`<p>${entry.correctionReason}</p>` : nothing}${entry.extension?.selfApproved ? html`<p>${t("attendance.self_approved")}</p>` : nothing}
    </li>`;
  }
  override render() {
    const selected = this.#selected;
    const disabled = this.#blocked || this.editorOpen || !this.lookups;
    const ownDay = this.view?.personId === this.lookups?.viewer.personId;
    return html`<div class="screen">
      <h1>${t(this.mode === "hours" ? "hours.tab" : "attendance.queue_heading")}</h1>
      ${this.mode === "hours" ? this.#periodControls(disabled) : nothing}
      <div class="selectors">
        <wt-combobox
          name="attendancePerson"
          .label=${t("attendance.worker")}
          .value=${this.personId}
          .options=${(this.hours?.people ?? this.lookups?.people)?.map((person) => ({ value: person.personId, label: person.displayName })) ?? []}
          .disabled=${disabled || !this.lookups}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#select(event, "personId")}
        ></wt-combobox>
        <wt-input
          name="attendanceDay"
          type="date"
          .label=${t("attendance.date")}
          .value=${this.date}
          .disabled=${disabled}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#select(event, "date")}
        ></wt-input>
      </div>
      <div class="actions">
        <wt-button
          data-open-day
          variant=${this.personId && this.date ? "primary" : "secondary"}
          .disabled=${disabled || !this.personId || !this.date}
          @click=${() => {
            if (!disabled && this.isConnected) {
              this.selectedItemId = null;
              void this.#day();
            }
          }}
          >${t("attendance.open_day")}</wt-button
        >
      </div>
      ${(!this.lookups && !this.readError) || this.reading || this.hoursReading ? html`<p role="status">${t("attendance.loading")}</p>` : nothing}
      ${this.mode === "hours" && this.lookups ? this.#hoursRecord(disabled) : nothing}
      ${(this.mode === "hours"
        ? (["waiting-manager", "waiting-worker", "disputed"] as const)
        : (["waiting-manager", "disputed"] as const)
      ).map((status) => {
        const items = this.lookups ? this.queue.filter((item) => item.status === status) : [];
        const heading =
          this.mode === "hours"
            ? statusLabel(status)
            : t(
                status === "waiting-manager"
                  ? "attendance.asked_to_change"
                  : "attendance.disputed_days",
              );
        return html`<section aria-label=${heading}>
          <h2>${heading}${this.mode === "corrections" ? ` · ${items.length}` : nothing}</h2>
          ${items.map(
            (item) =>
              html`<article>
                <p>
                  <strong>${this.#person(item.personId)}</strong> ·
                  ${wallClock(item.changes[0]!.at, item.changes[0]!.offsetMinutes).date}
                </p>
                <p>${item.reason}</p>
                <wt-button
                  data-detail
                  .disabled=${disabled}
                  variant="secondary"
                  @click=${() => this.#details(item)}
                  >${t("attendance.details")}</wt-button
                >
              </article>`,
          )}
        </section>`;
      })}
      ${
        this.mode === "corrections" && this.lookups && this.finishedDays
          ? renderAttendanceFinishedDays(
              this.finishedDays,
              this.lookups,
              disabled || !!this.readError,
              this.#approveDays,
            )
          : nothing
      }
      ${
        this.view
          ? html`<section data-day>
              <h2>
                ${this.#person(this.view.personId)} ·
                ${this.mode === "hours" ? hoursDate(this.view.date, this.periodFrom?.start) : this.view.date}
              </h2>
              ${this.view.record.entries.length === 0 ? html`<p>${t("attendance.no_times")}</p>` : nothing}
              <ul>
                ${this.view.record.entries.map((projected) => html`${this.#history(projected.entry)}${projected.effective && projected.author.kind === "automatic" ? html`<li>${t("attendance.automatic_counted")}</li>` : nothing}${projected.confirmedByWorker ? html`<li>${t("attendance.confirmed_by_worker")}</li>` : nothing}${projected.selfApproved ? html`<li>${t("attendance.self_approved")}</li>` : nothing}${projected.effective && !ownDay ? html`<li><wt-button data-retime .disabled=${disabled} variant="primary" @click=${() => this.#retime(projected.entry)}>${t("attendance.propose")}</wt-button></li>` : nothing}`)}
              </ul>
              ${this.view.items.map(
                (item) =>
                  html`<article>
                    <p>${statusLabel(item.status)}</p>
                    <p>${item.reason}</p>
                    <ul>
                      ${item.history.map((entry) => this.#history(entry))}
                    </ul>
                  </article>`,
              )}
              ${selected?.status === "waiting-manager" && !selected.readyToApply ? html`<p>${t("attendance.sequence_blocked")}</p>` : nothing}
              ${selected ? html`<div class="actions">${this.#canApprove(selected) ? html`<wt-button data-approve variant="primary" .disabled=${disabled} @click=${() => this.#settle("approve")}>${t("attendance.approve")}</wt-button>` : nothing}${this.#canDecline(selected) ? html`<wt-button data-decline variant="danger" .disabled=${disabled} @click=${() => this.#settle("decline")}>${t("attendance.decline")}</wt-button>` : nothing}</div>` : nothing}
              ${ownDay ? html`<p><a data-own-hours href="/my-schedule/view/hours">${t("attendance.self_change")}</a></p>` : html`<div class="actions">${(["in", "out", "break_start", "break_end"] as const).map((kind) => html`<wt-button data-add-kind=${kind} variant="primary" .disabled=${disabled} @click=${() => this.#missing([kind])}>${t("attendance.add_missing")} · ${t(`clock.${kind}`)}</wt-button>`)}<wt-button data-add-shift variant="primary" .disabled=${disabled} @click=${() => this.#missing(["in", "out"])}>${t("attendance.add_shift")}</wt-button><wt-button data-add-break variant="primary" .disabled=${disabled} @click=${() => this.#missing(["break_start", "break_end"])}>${t("attendance.add_break")}</wt-button></div>`}
            </section>`
          : nothing
      }
      ${this.readError ? html`<p class="error" data-read-error role="alert">${this.readError}</p>` : nothing}
      ${this.actionError ? html`<p class="error" data-action-error role="alert">${this.actionError}</p>` : nothing}
      ${this.#staleEditor ? html`<p role="status">${t("attendance.stale")}</p>` : nothing}
      ${this.uncertain || this.retry ? html`<p role="status">${t(this.uncertain ? "attendance.uncertain" : "attendance.retry_response_message")}</p>` : nothing}
      ${this.readError || this.uncertain ? html`<wt-button data-retry-read variant="secondary" .disabled=${this.busy} @click=${() => void this.#retryRead()}>${t("attendance.retry_read")}</wt-button>` : nothing}
      ${this.retry ? html`<wt-button data-retry-command variant="primary" .disabled=${this.busy} @click=${() => this.#retryCommand()}>${t("attendance.retry_response")}</wt-button>` : nothing}
      ${this.exportError ? html`<p class="error" role="alert" data-export-error>${this.exportError}</p>` : nothing}
      <dashboard-attendance-export-dialog
        mode="manager"
        .open=${this.exportOpen}
        .request=${this.request}
        .scopeKey=${`${this.#generation}`}
        .period=${this.hours?.period ?? { start: "", end: "" }}
        .people=${this.hours?.people ?? this.lookups?.people ?? []}
        .personId=${this.personId || undefined}
        @export-close=${() => {
          this.exportOpen = false;
        }}
      ></dashboard-attendance-export-dialog>
      <dashboard-attendance-proposal-dialog
        .view=${this.view}
        .open=${this.editorOpen}
        .initialChanges=${this.editorChanges}
        .timeZone=${this.view?.timeZone ?? "UTC"}
        .busy=${this.busy}
        .blocked=${this.#pending !== null || this.#staleEditor}
        .recovery=${this.uncertain ? "uncertain" : this.retry ? "retry" : null}
        .reasonRefusal=${this.reasonRefusal}
        .error=${this.actionError || (this.#staleEditor ? t("attendance.stale") : "")}
        @proposal-save=${this.#propose}
        @proposal-cancel=${() => {
          this.editorOpen = false;
        }}
        @retry-attendance=${() => void this.#retryRead()}
        @retry-attendance-command=${() => this.#retryCommand()}
      ></dashboard-attendance-proposal-dialog>
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-attendance-corrections-screen": AttendanceCorrectionsScreen;
  }
}
