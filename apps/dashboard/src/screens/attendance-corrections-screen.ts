import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { QueryController, type DashboardRequest, type LiveData } from "@waitron/dashboard-kit";
import type {
  AttendanceChange,
  AttendanceCommand,
  AttendanceCommandResult,
  AttendanceDayView,
  AttendanceLookups,
  CorrectionItem,
} from "@waitron/dashboard-modules";
import { baseStyles } from "@waitron/ui";
import { AttendanceApi } from "../api/attendance.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import "../widgets/attendance-proposal-dialog.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";

type Entry = AttendanceDayView["record"]["entries"][number]["entry"];
function storedTime(at: string, offset: number): string {
  const wall = new Date(Date.parse(at) + offset * 60_000).toISOString();
  const abs = Math.abs(offset);
  return `${wall.slice(0, 10)} ${wall.slice(11, 16)} ${offset < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
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
    css`
      :host {
        display: block;
        color: var(--wt-color-text);
      }
      h1 {
        font-size: var(--wt-font-size-xl);
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
      }
      .screen,
      section,
      article,
      ul {
        grid-template-columns: minmax(0, 1fr);
      }
      .selectors {
        grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--wt-form-max-width)), 1fr));
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
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
  @property({ attribute: false }) request!: DashboardRequest;
  @property({ attribute: false }) liveData?: LiveData;
  @state() private lookups: AttendanceLookups | null = null;
  @state() private locationId = "";
  @state() private personId = "";
  @state() private date = "";
  @state() private queue: CorrectionItem[] = [];
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
      (!this.#initialized || changed.has("request") || changed.has("liveData"))
    )
      void this.#start();
  }
  async #start(): Promise<void> {
    this.#initialized = true;
    this.#generation++;
    this.#actionWait?.abort();
    for (const slot of ["lookups", "queue", "day"]) this.#queries.release(slot);
    this.#api = new AttendanceApi(this.request, this.liveData);
    this.lookups = null;
    this.view = null;
    this.queue = [];
    this.locationId = "";
    this.personId = "";
    this.editorOpen = false;
    this.#pending = null;
    this.uncertain = false;
    this.retry = false;
    this.busy = false;
    this.readError = "";
    this.actionError = "";
    try {
      await this.#queries.watch("lookups", this.#api.lookupsQuery(), async (value) => {
        const previous = this.locationId;
        const previousPerson = this.personId;
        this.lookups = value;
        this.locationId =
          value.locations.find((location) => location.id === this.locationId)?.id ??
          value.locations[0]?.id ??
          "";
        if (!value.people.some((person) => person.personId === this.personId))
          this.personId = value.people[0]?.personId ?? "";
        if (previous !== this.locationId || previousPerson !== this.personId) {
          this.#queries.release("day");
          this.view = null;
          this.selectedItemId = null;
          this.reading = false;
        }
        if (previous !== this.locationId) await this.#watchQueue();
      });
    } catch {
      /* QueryController publishes the read's failure. */
    }
  }
  async #watchQueue(): Promise<void> {
    if (!this.locationId) {
      this.#queries.release("queue");
      this.queue = [];
      return;
    }
    await this.#queries.watch("queue", this.#api!.queueQuery(this.locationId), (value) => {
      this.queue = value.items;
    });
  }
  #person(id: string): string {
    return this.lookups?.people.find((person) => person.personId === id)?.displayName ?? id;
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
  #select(event: CustomEvent<{ value: string }>, field: "locationId" | "personId" | "date"): void {
    event.stopPropagation();
    if (this.#blocked || this.editorOpen || !this.isConnected) return;
    this[field] = event.detail.value;
    this.#queries.release("day");
    this.view = null;
    this.selectedItemId = null;
    this.reading = false;
    if (field === "locationId") {
      this.queue = [];
      void this.#watchQueue().catch(() => undefined);
    }
  }
  async #day(): Promise<void> {
    if (!this.personId || !this.locationId || !/^\d{4}-\d{2}-\d{2}$/.test(this.date)) return;
    const generation = this.#generation;
    const [personId, locationId, date] = [this.personId, this.locationId, this.date];
    this.reading = true;
    try {
      await this.#queries.watch("day", this.#api!.dayQuery(personId, locationId, date), (value) => {
        if (value.personId !== personId || value.locationId !== locationId || value.date !== date)
          throw new TypeError("Attendance day does not match the selection");
        this.view = value;
      });
    } catch {
      /* QueryController publishes the read's failure. */
    } finally {
      if (
        generation === this.#generation &&
        this.personId === personId &&
        this.locationId === locationId &&
        this.date === date
      )
        this.reading = false;
    }
  }
  #details(item: CorrectionItem): void {
    if (this.#blocked || this.editorOpen || !this.isConnected) return;
    this.personId = item.personId;
    this.locationId = item.locationId;
    this.selectedItemId = item.id;
    this.view = null;
    const change = item.changes[0]!;
    this.date = storedTime(change.at, change.offsetMinutes).slice(0, 10);
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
      locationId: this.view.locationId,
      ...event.detail,
    });
  }
  async #refresh(): Promise<void> {
    await Promise.allSettled([this.#watchQueue(), this.#day()]);
  }
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
    this.busy = true;
    try {
      if (this.#pending) await this.#recover(this.#pending);
      else await this.#refresh();
    } finally {
      if (generation === this.#generation) this.busy = false;
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
    return html`<li>
      <span data-entry-kind
        >${["in", "out", "break_start", "break_end"].includes(entry.entryKind) ? t(`clock.${entry.entryKind as "in" | "out" | "break_start" | "break_end"}`) : entry.extension?.missingEntryKind ? t(`clock.${entry.extension.missingEntryKind}`) : nothing}</span
      ><span> · ${label}: </span
      ><time datetime=${entry.eventAt}>${storedTime(entry.eventAt, entry.offsetMinutes)}</time>
      <p>
        ${author === "automatic" ? t("attendance.author_automatic") : this.#person(entry.recordedByPersonId ?? entry.personId)}
        · ${t("attendance.recorded")}: <time datetime=${entry.recordedAt}>${entry.recordedAt}</time>
      </p>
      ${entry.correctionReason ? html`<p>${entry.correctionReason}</p>` : nothing}${entry.extension?.selfApproved ? html`<p>${t("attendance.self_approved")}</p>` : nothing}
    </li>`;
  }
  override render() {
    const selected = this.#selected;
    const disabled = this.#blocked || this.editorOpen;
    const ownDay = this.view?.personId === this.lookups?.viewer.personId;
    return html`<div class="screen">
      <h1>${t("attendance.queue_heading")}</h1>
      <div class="selectors">
        <wt-combobox
          name="attendanceLocation"
          .label=${t("attendance.location")}
          .value=${this.locationId}
          .options=${this.lookups?.locations.map((location) => ({ value: location.id, label: location.name })) ?? []}
          .disabled=${disabled || !this.lookups}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#select(event, "locationId")}
        ></wt-combobox>
        <wt-combobox
          name="attendancePerson"
          .label=${t("attendance.worker")}
          .value=${this.personId}
          .options=${this.lookups?.people.map((person) => ({ value: person.personId, label: person.displayName })) ?? []}
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
          variant=${this.personId && this.date && this.locationId ? "primary" : "secondary"}
          .disabled=${disabled || !this.personId || !this.date || !this.locationId}
          @click=${() => {
            if (!disabled && this.isConnected) {
              this.selectedItemId = null;
              void this.#day();
            }
          }}
          >${t("attendance.open_day")}</wt-button
        >
      </div>
      ${(!this.lookups && !this.readError) || this.reading ? html`<p role="status">${t("attendance.loading")}</p>` : nothing}
      ${(["waiting-manager", "waiting-worker", "disputed"] as const).map(
        (status) =>
          html`<section aria-label=${statusLabel(status)}>
            <h2>${statusLabel(status)}</h2>
            ${this.queue
              .filter((item) => item.status === status)
              .map(
                (item) =>
                  html`<article>
                    <p>${this.#person(item.personId)} · ${item.reason}</p>
                    <wt-button
                      data-detail
                      .disabled=${disabled}
                      variant="primary"
                      @click=${() => this.#details(item)}
                      >${t("attendance.details")}</wt-button
                    >
                  </article>`,
              )}
          </section>`,
      )}
      ${
        this.view
          ? html`<section data-day>
              <h2>${this.#person(this.view.personId)} · ${this.view.date}</h2>
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
              ${ownDay ? html`<p>${t("attendance.self_change")}</p>` : html`<div class="actions">${(["in", "out", "break_start", "break_end"] as const).map((kind) => html`<wt-button data-add-kind=${kind} variant="primary" .disabled=${disabled} @click=${() => this.#missing([kind])}>${t("attendance.add_missing")} · ${t(`clock.${kind}`)}</wt-button>`)}<wt-button data-add-shift variant="primary" .disabled=${disabled} @click=${() => this.#missing(["in", "out"])}>${t("attendance.add_shift")}</wt-button><wt-button data-add-break variant="primary" .disabled=${disabled} @click=${() => this.#missing(["break_start", "break_end"])}>${t("attendance.add_break")}</wt-button></div>`}
            </section>`
          : nothing
      }
      ${this.readError ? html`<p class="error" data-read-error role="alert">${this.readError}</p>` : nothing}
      ${this.actionError ? html`<p class="error" data-action-error role="alert">${this.actionError}</p>` : nothing}
      ${this.#staleEditor ? html`<p role="status">${t("attendance.stale")}</p>` : nothing}
      ${this.uncertain || this.retry ? html`<p role="status">${t(this.uncertain ? "attendance.uncertain" : "attendance.retry_response_message")}</p>` : nothing}
      ${this.readError || this.uncertain ? html`<wt-button data-retry-read variant="secondary" .disabled=${this.busy} @click=${() => void this.#retryRead()}>${t("attendance.retry_read")}</wt-button>` : nothing}
      ${this.retry ? html`<wt-button data-retry-command variant="primary" .disabled=${this.busy} @click=${() => this.#retryCommand()}>${t("attendance.retry_response")}</wt-button>` : nothing}
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
