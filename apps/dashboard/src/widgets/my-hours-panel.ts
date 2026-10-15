import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { QueryController, type DashboardRequest, type LiveData } from "@waitron/dashboard-kit";
import type {
  AttendanceChange,
  AttendanceDayView,
  AttendanceInbox,
  HoursSelection,
  OwnAttendanceCommand,
  AttendanceCommandResult,
  PersonHours,
} from "@waitron/dashboard-modules";
import { baseStyles } from "@waitron/ui";
import { HoursApi } from "../api/hours.js";
import { OwnAttendanceApi } from "../api/own-attendance.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { attendanceHistory } from "./attendance-history.js";
import "./hours-record.js";
import "./attendance-proposal-dialog.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
@customElement("dashboard-my-hours-panel")
export class MyHoursPanel extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        color: var(--wt-color-text);
      }
      .content,
      section,
      article {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      .selectors,
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        align-items: center;
      }
      .selectors > * {
        flex: 1;
        min-width: min(100%, var(--wt-form-max-width));
      }
      p,
      h2,
      h3,
      ul {
        margin: 0;
        overflow-wrap: anywhere;
      }
      section,
      article {
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      h2 {
        font-size: var(--wt-font-size-lg);
      }
      h3 {
        font-size: var(--wt-font-size-md);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) request!: DashboardRequest;
  @property({ attribute: false }) liveData?: LiveData;
  @property() personId = "";
  @property({ type: Boolean }) active = false;
  @state() private inbox: AttendanceInbox | null = null;
  @state() private view: PersonHours | null = null;
  @state() private day: AttendanceDayView | null = null;
  @state() private locationId = "";
  @state() private selection: HoursSelection = { kind: "week" };
  @state() private reading = false;
  @state() private readError = "";
  @state() private actionError = "";
  @state() private reasonRefusal = "";
  @state() private busy = false;
  @state() private uncertain = false;
  @state() private retry = false;
  @state() private editorOpen = false;
  @state() private editorChanges: AttendanceChange[] = [];
  @state() private reasonOnly = false;
  #hours?: HoursApi;
  #own?: OwnAttendanceApi;
  #generation = 0;
  #initialized = false;
  #pending: OwnAttendanceCommand | null = null;
  #editorRevision = "";
  #editorQuestion: string | null = null;
  #editorItem: string | null = null;
  #wait?: AbortController;
  readonly #readErrors = new Map<string, string>();
  readonly #reads = {
    inbox: this.#readController("inbox"),
    hours: this.#readController("hours"),
    day: this.#readController("day"),
  };
  #readController(slot: string): QueryController {
    return new QueryController(
      this,
      () => this.liveData,
      (error) => {
        const message = codeMessage(codeOf(error));
        const status = (error as { status?: number } | null)?.status;
        if (status === 401 || status === 403) this.#clear();
        this.#readErrors.set(slot, message);
        this.#showReadError();
      },
      () => {
        this.#readErrors.delete(slot);
        this.#showReadError();
      },
    );
  }
  #showReadError(): void {
    this.readError = this.#readErrors.values().next().value ?? "";
  }
  #release(slot: "inbox" | "hours" | "day"): void {
    this.#reads[slot].release(slot);
    this.#readErrors.delete(slot);
    this.#showReadError();
  }

  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.#clear();
    this.#initialized = false;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues) {
    if (!this.isConnected) return;
    if (
      !this.#initialized ||
      changed.has("active") ||
      changed.has("personId") ||
      changed.has("request") ||
      changed.has("liveData")
    ) {
      this.#initialized = true;
      this.#clear();
      if (this.active && this.personId && this.request) {
        this.#hours = new HoursApi(this.request, this.liveData);
        this.#own = new OwnAttendanceApi(this.request, this.liveData);
        void this.#refresh();
      }
    }
  }
  #clear() {
    this.#generation++;
    this.#wait?.abort();
    for (const slot of ["inbox", "hours", "day"] as const) this.#release(slot);
    this.inbox = null;
    this.view = null;
    this.day = null;
    this.locationId = "";
    this.selection = { kind: "week" };
    this.reading = false;
    this.editorOpen = false;
    this.editorChanges = [];
    this.#pending = null;
    this.busy = false;
    this.uncertain = false;
    this.retry = false;
    this.actionError = "";
    this.reasonRefusal = "";
    this.readError = "";
  }
  get #blocked() {
    return this.busy || this.#pending !== null;
  }
  get #stale() {
    return (
      this.editorOpen &&
      this.#editorRevision !==
        (this.#editorItem || this.#editorQuestion ? this.inbox?.revision : this.day?.revision)
    );
  }
  async #refresh() {
    if (!this.active || !this.#hours) return;
    const generation = this.#generation;
    let watchedHours = false;
    this.reading = true;
    try {
      await this.#reads.inbox.watch("inbox", this.#hours.ownInboxQuery(), async (value) => {
        if (value.personId !== this.personId)
          throw new TypeError("Attendance inbox owner mismatch");
        this.inbox = value;
        const location =
          value.locations.find((l) => l.id === this.locationId)?.id ?? value.locations[0]?.id ?? "";
        if (location !== this.locationId) {
          this.locationId = location;
          this.#release("hours");
          this.view = null;
          this.day = null;
          this.#release("day");
          watchedHours = true;
          await this.#watchHours();
        }
      });
      if (generation === this.#generation && this.locationId && !watchedHours)
        await this.#watchHours();
    } catch {
      /* QueryController owns read failures. */
    } finally {
      if (generation === this.#generation) this.reading = false;
    }
  }
  async #watchHours() {
    if (!this.locationId || !this.#hours) return;
    const location = this.locationId,
      person = this.personId,
      selection = { ...this.selection };
    await this.#reads.hours.watch("hours", this.#hours.ownQuery(location, selection), (value) => {
      if (
        value.personId !== person ||
        value.locationId !== location ||
        value.selection.kind !== selection.kind ||
        value.selection.date !== selection.date
      )
        throw new TypeError("Hours owner or selection mismatch");
      this.view = value;
    });
  }
  async #select(event: CustomEvent<{ value: string }>, field: "location" | "kind" | "date") {
    event.stopPropagation();
    if (this.#blocked || this.editorOpen || !this.isConnected) return;
    const value = event.detail.value;
    if (field === "location") {
      if (!this.inbox?.locations.some((l) => l.id === value)) return;
      this.locationId = value;
    } else if (field === "kind") {
      if (value !== "week" && value !== "month") return;
      this.selection = { ...this.selection, kind: value };
    } else {
      const at = Date.parse(`${value}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(at) ||
        new Date(at).toISOString().slice(0, 10) !== value
      )
        return;
      this.selection = { ...this.selection, date: value };
    }
    this.view = null;
    this.day = null;
    this.#release("day");
    const generation = this.#generation,
      location = this.locationId,
      selection = this.selection;
    this.reading = true;
    try {
      await this.#watchHours();
    } catch {
      /* QueryController owns read failures. */
    } finally {
      if (
        generation === this.#generation &&
        location === this.locationId &&
        selection === this.selection
      )
        this.reading = false;
    }
  }
  #move(direction: number): void {
    const anchor = this.selection.date ?? this.view?.businessDay;
    if (!anchor || this.#blocked || this.editorOpen || this.reading) return;
    const date = new Date(`${anchor}T00:00:00Z`);
    if (this.selection.kind === "month") {
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + direction);
    } else date.setUTCDate(date.getUTCDate() + direction * 7);
    void this.#select(
      new CustomEvent("wt-change", { detail: { value: date.toISOString().slice(0, 10) } }),
      "date",
    );
  }
  async #openDay(event: CustomEvent<{ date: string; locationId: string }>) {
    event.stopPropagation();
    if (
      this.#blocked ||
      this.editorOpen ||
      !this.view ||
      event.detail.locationId !== this.locationId ||
      !this.view.days.some((d) => d.date === event.detail.date)
    )
      return;
    await this.#readDay(event.detail.date, event.detail.locationId);
  }
  async #readDay(date: string, location: string): Promise<boolean> {
    const person = this.personId;
    if (!this.#own) return false;
    this.day = null;
    try {
      await this.#reads.day.watch("day", this.#own.dayQuery(location, date), (value) => {
        if (value.personId !== person || value.locationId !== location || value.date !== date)
          throw new TypeError("Own day mismatch");
        this.day = value;
      });
      return this.day !== null;
    } catch {
      return false;
    }
  }
  #edit(changes: AttendanceChange[], question: string | null = null, item: string | null = null) {
    if (!this.day || this.#blocked || !this.active || !this.isConnected) return;
    this.#editorRevision = question || item ? this.inbox!.revision : this.day.revision;
    this.#editorQuestion = question;
    this.#editorItem = item;
    this.reasonOnly = item !== null;
    this.editorChanges = structuredClone(changes);
    this.actionError = "";
    this.reasonRefusal = "";
    this.editorOpen = true;
  }
  async #prompt(promptId: string, action: "confirm" | "edit" | "accept" | "disagree") {
    if (this.#blocked || this.editorOpen || this.reading || !this.isConnected || !this.active)
      return;
    const prompt = this.inbox?.prompts.find((p) => p.id === promptId);
    if (!prompt) return;
    if (action === "confirm" && prompt.kind === "automatic-out" && prompt.questionId) {
      void this.#send({
        action: "confirm",
        questionId: prompt.questionId,
        commandId: crypto.randomUUID(),
        expectedRevision: this.inbox!.revision,
      });
      return;
    }
    const item = this.inbox?.items.find((i) => i.id === prompt.itemId);
    if (action === "accept" && prompt.kind === "proposal" && item?.readyToApply) {
      void this.#send({
        action: "accept",
        itemId: item.id,
        commandId: crypto.randomUUID(),
        expectedRevision: this.inbox!.revision,
      });
      return;
    }
    if (!prompt.businessDay || (action !== "edit" && action !== "disagree")) return;
    const generation = this.#generation;
    const inbox = this.inbox;
    await this.#readDay(prompt.businessDay, prompt.locationId);
    if (
      generation !== this.#generation ||
      this.inbox !== inbox ||
      !this.day ||
      this.day.locationId !== prompt.locationId ||
      this.day.date !== prompt.businessDay
    )
      return;
    if (action === "disagree" && prompt.kind === "proposal" && item) this.#edit([], null, item.id);
    else if (action === "edit" && prompt.kind !== "proposal") {
      const automatic = prompt.history.find((e) => e.entryId === prompt.automaticEntryId);
      this.#edit(
        automatic
          ? [
              {
                target: { entryId: automatic.entryId },
                at: automatic.eventAt,
                offsetMinutes: automatic.offsetMinutes,
              },
            ]
          : prompt.missingKinds.map((missingKind) => ({
              target: { missingKind },
              at: "",
              offsetMinutes: 0,
            })),
        prompt.questionId,
      );
    }
  }
  #save(event: CustomEvent<{ changes: AttendanceChange[]; reason: string }>) {
    event.stopPropagation();
    if (
      !this.editorOpen ||
      this.#blocked ||
      this.#stale ||
      !this.day ||
      !this.active ||
      !this.isConnected
    )
      return;
    const shared = { commandId: crypto.randomUUID(), expectedRevision: this.#editorRevision };
    void this.#send(
      this.#editorItem
        ? { ...shared, action: "disagree", itemId: this.#editorItem, reason: event.detail.reason }
        : {
            ...shared,
            action: "request",
            questionId: this.#editorQuestion,
            locationId: this.day.locationId,
            ...event.detail,
          },
    );
  }
  async #bounded<T>(operation: Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.#wait = controller;
    const timer = setTimeout(() => controller.abort(), 25000);
    let abort!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      abort = () => reject({ code: "connection.timed_out" });
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([operation, stopped]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
      if (this.#wait === controller) this.#wait = undefined;
    }
  }
  async #saved(result: AttendanceCommandResult, command: OwnAttendanceCommand) {
    if (result.commandId !== command.commandId)
      throw new TypeError("Own result belongs to another command");
    this.#pending = null;
    this.uncertain = false;
    this.retry = false;
    this.editorOpen = false;
    this.actionError = "";
    this.reasonRefusal = "";
    this.#hours?.invalidate();
    await this.updateComplete;
    await this.#refresh();
  }
  async #send(command: OwnAttendanceCommand, retry = false) {
    if (!this.isConnected || !this.active || this.busy || (this.#pending && !retry)) return;
    const generation = this.#generation;
    this.busy = true;
    this.actionError = "";
    this.reasonRefusal = "";
    this.retry = false;
    try {
      const result = await this.#bounded(this.#own!.send(command));
      if (generation !== this.#generation) return;
      await this.#saved(result, command);
    } catch (error) {
      if (generation !== this.#generation) return;
      const status = (error as { status?: number } | null)?.status;
      if (typeof status === "number" && status >= 400 && status < 500) {
        this.#pending = null;
        this.uncertain = false;
        if ((error as { params?: { field?: string } }).params?.field === "reason")
          this.reasonRefusal = t("attendance.check_reason");
        else this.actionError = codeMessage(codeOf(error));
      } else {
        this.#pending = command;
        this.uncertain = true;
        await this.#recover(command);
      }
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  async #recover(command: OwnAttendanceCommand) {
    const generation = this.#generation;
    try {
      const result = await this.#bounded(this.#own!.command(command.commandId));
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
  async #retryRead() {
    if (this.busy || !this.isConnected || !this.active) return;
    const generation = this.#generation;
    this.busy = true;
    try {
      if (this.#pending) await this.#recover(this.#pending);
      else await this.#refresh();
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  #retryCommand() {
    if (this.retry && this.#pending) void this.#send(this.#pending, true);
  }
  #promptRow(prompt: AttendancePrompt) {
    const item = this.inbox?.items.find((i) => i.id === prompt.itemId);
    const button = (action: "confirm" | "edit" | "accept" | "disagree", label: string) =>
      html`<wt-button
        data-prompt-action=${action}
        variant="primary"
        .disabled=${this.#blocked || this.editorOpen || this.reading || (action === "accept" && !item?.readyToApply)}
        @click=${() => void this.#prompt(prompt.id, action)}
        >${label}</wt-button
      >`;
    return html`<article>
      <h3>${prompt.locationName} · ${prompt.businessDay ?? ""}</h3>
      <ul>
        ${prompt.history.map(attendanceHistory)}
      </ul>
      <div class="actions">
        ${prompt.kind === "automatic-out" ? button("confirm", t("attendance.confirm")) : nothing}${prompt.kind === "proposal" ? html`${button("accept", t("attendance.accept"))}${button("disagree", t("attendance.disagree"))}` : button("edit", t("attendance.fix_hours"))}
      </div>
    </article>`;
  }
  override render() {
    if (!this.active) return nothing;
    const disabled = this.#blocked || this.editorOpen;
    return html`<div class="content">
      <div class="selectors">
        <wt-combobox
          name="hoursLocation"
          label=${t("attendance.location")}
          .value=${this.locationId}
          .options=${this.inbox?.locations.map((l) => ({ value: l.id, label: l.name })) ?? []}
          .disabled=${disabled || !this.inbox}
          @wt-change=${(e: CustomEvent<{ value: string }>) => void this.#select(e, "location")}
        ></wt-combobox>
        <wt-combobox
          name="hoursWindow"
          label=${t("hours.window")}
          .value=${this.selection.kind}
          .options=${[
            { value: "week", label: t("hours.week") },
            { value: "month", label: t("hours.month") },
          ]}
          .disabled=${disabled}
          @wt-change=${(e: CustomEvent<{ value: string }>) => void this.#select(e, "kind")}
        ></wt-combobox>
        <wt-input
          name="hoursDate"
          type="date"
          label=${t("attendance.date")}
          .value=${this.selection.date ?? this.view?.businessDay ?? ""}
          .disabled=${disabled}
          @wt-change=${(e: CustomEvent<{ value: string }>) => void this.#select(e, "date")}
        ></wt-input>
        <wt-button
          data-refresh
          variant="secondary"
          .disabled=${this.busy || this.reading}
          @click=${() => void this.#retryRead()}
          >${t("hours.refresh")}</wt-button
        >
      </div>
      <div class="actions">
        <wt-button
          data-previous
          variant="secondary"
          .disabled=${disabled || this.reading || !this.view}
          @click=${() => this.#move(-1)}
          >${t("hours.previous")}</wt-button
        ><wt-button
          data-next
          variant="secondary"
          .disabled=${disabled || this.reading || !this.view}
          @click=${() => this.#move(1)}
          >${t("hours.next")}</wt-button
        >
      </div>
      ${this.reading ? html`<p role="status">${t("attendance.loading")}</p>` : nothing}
      ${this.readError ? html`<p class="error" role="alert" data-read-error>${this.readError}</p>` : nothing}
      <dashboard-hours-record
        .view=${this.view}
        .dayActionLabel=${t("attendance.fix_hours")}
        .blocked=${disabled || this.reading || !this.inbox}
        @hours-day=${this.#openDay}
      ></dashboard-hours-record>
      ${
        this.inbox?.prompts.length
          ? html`<section>
              <h2>${t("hours.pending")}</h2>
              ${this.inbox.prompts.map((p) => this.#promptRow(p))}
            </section>`
          : nothing
      }
      ${
        this.day
          ? html`<section data-day>
              <h2>${this.day.date}</h2>
              <ul>
                ${this.day.record.entries.map((row) => html`${attendanceHistory(row.entry)}${row.effective ? html`<li><wt-button data-retime variant="primary" .disabled=${disabled} @click=${() => this.#edit([{ target: { entryId: row.entry.entryId }, at: row.entry.eventAt, offsetMinutes: row.entry.offsetMinutes }])}>${t("attendance.fix_hours")}</wt-button></li>` : nothing}`)}
              </ul>
              <div class="actions">
                ${(["in", "out", "break_start", "break_end"] as const).map((kind) => html`<wt-button data-add-kind=${kind} variant="primary" .disabled=${disabled} @click=${() => this.#edit([{ target: { missingKind: kind }, at: "", offsetMinutes: 0 }])}>${t("attendance.add_missing")} · ${t(`clock.${kind}`)}</wt-button>`)}<wt-button
                  data-add-shift
                  variant="primary"
                  .disabled=${disabled}
                  @click=${() =>
                    this.#edit([
                      { target: { missingKind: "in" }, at: "", offsetMinutes: 0 },
                      { target: { missingKind: "out" }, at: "", offsetMinutes: 0 },
                    ])}
                  >${t("attendance.add_shift")}</wt-button
                >
              </div>
            </section>`
          : nothing
      }
      ${this.actionError ? html`<p class="error" role="alert" data-action-error>${this.actionError}</p>` : nothing}
      ${
        this.uncertain
          ? html`<p role="status">${t("attendance.uncertain")}</p>
              <wt-button
                data-retry-read
                variant="secondary"
                .disabled=${this.busy}
                @click=${() => void this.#retryRead()}
                >${t("attendance.retry_read")}</wt-button
              >`
          : nothing
      }
      ${
        this.retry
          ? html`<p role="status">${t("attendance.retry_response_message")}</p>
              <wt-button
                data-retry-command
                variant="primary"
                .disabled=${this.busy}
                @click=${() => this.#retryCommand()}
                >${t("attendance.retry_response")}</wt-button
              >`
          : nothing
      }
      <dashboard-attendance-proposal-dialog
        purpose="request"
        .view=${this.day}
        .open=${this.editorOpen}
        .initialChanges=${this.editorChanges}
        .timeZone=${this.day?.timeZone ?? "UTC"}
        .reasonOnly=${this.reasonOnly}
        .busy=${this.busy}
        .blocked=${this.#pending !== null || this.#stale}
        .recovery=${this.uncertain ? "uncertain" : this.retry ? "retry" : null}
        .reasonRefusal=${this.reasonRefusal}
        .error=${this.actionError || (this.#stale ? t("attendance.stale") : "")}
        @proposal-save=${this.#save}
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
    "dashboard-my-hours-panel": MyHoursPanel;
  }
}

type AttendancePrompt = AttendanceInbox["prompts"][number];
