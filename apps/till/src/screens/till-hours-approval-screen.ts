import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import { formatDuration } from "@waitron/shared";
import type {
  AttendanceChange,
  AttendanceCommand,
  AttendanceDayView,
  AttendanceLookups,
  AttendanceManagerQueue,
  CorrectionItem,
  FinishedAttendanceDay,
} from "@waitron/workforce/attendance-contract";
import "@waitron/ui/src/components/wt-full-screen-panel.js";
import "@waitron/ui/src/components/wt-top-bar.js";
import "@waitron/ui/src/components/wt-icon-button.js";
import "../widgets/attendance-correction-dialog.js";
import type { ManagerDay } from "./till-hours-day-editor.js";
import { isNetworkFailure, type TillApi } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { limited, pause } from "../state/draft-sync.js";
import { storedAttendanceTime } from "../widgets/attendance-history.js";

interface DaySelection {
  personId: string;
  date: string;
}
type RequestOptions = { signal: AbortSignal };

function workerDate(item: CorrectionItem): string {
  const first = item.changes[0]!;
  return item.date ?? storedAttendanceTime(first.at, first.offsetMinutes).slice(0, 10);
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function weekdayAndDay(date: string): string {
  const parts = new Intl.DateTimeFormat(currentLocale(), {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(`${date}T00:00:00Z`));
  return `${parts.find((part) => part.type === "weekday")?.value} ${parts.find((part) => part.type === "day")?.value}`;
}

function timeText(change: { at: string; offsetMinutes: number }, date: string) {
  const value = storedAttendanceTime(change.at, change.offsetMinutes);
  return value.slice(0, 10) === date
    ? value.slice(11, 16)
    : `${shortDate(value.slice(0, 10))} ${value.slice(11, 16)}`;
}

function changeLine(item: CorrectionItem, change: AttendanceChange, date: string) {
  const target = change.target;
  const recorded =
    "entryId" in target
      ? item.history.find((entry) => entry.entryId === target.entryId)
      : undefined;
  const kind =
    "missingKind" in target
      ? target.missingKind
      : (recorded?.extension?.missingEntryKind ?? recorded?.entryKind);
  const label =
    kind === "in" || kind === "out" || kind === "break_start" || kind === "break_end"
      ? t(`hours.time_${kind}`)
      : t("attendance.time");
  const before =
    recorded && timeText({ at: recorded.eventAt, offsetMinutes: recorded.offsetMinutes }, date);
  const disputed = item.status === "disputed";
  const times = `${before ? `${before} → ` : ""}${timeText(change, date)}`;
  return html`${disputed ? label.toLocaleLowerCase(currentLocale()) : label}
  ${disputed ? html`<span>${times}</span>` : html`<strong>${times}</strong>`}
  ${
    before && recorded?.extension?.authorKind === "automatic"
      ? html`<span>${fill(t("hours.time_added_by_waitron"), { time: before })}</span>`
      : nothing
  }`;
}

function quotedReason(reason: string): string {
  return fill(t("hours.quoted_reason"), { reason });
}

@customElement("till-hours-approval-screen")
export class TillHoursApprovalScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        block-size: 100%;
      }
      :host(:not([active])) {
        display: none;
      }
      .list {
        max-inline-size: var(--wt-form-max-width);
        display: grid;
        gap: var(--wt-space-4);
        padding: var(--wt-space-3);
      }
      section,
      article {
        display: grid;
        gap: var(--wt-space-2);
        min-inline-size: 0;
      }
      h3,
      p,
      dl,
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      h3 {
        padding-inline-start: var(--wt-space-1);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        letter-spacing: var(--wt-letter-spacing-caps);
        text-transform: uppercase;
      }
      header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: baseline;
        gap: var(--wt-space-2);
      }
      article {
        padding: calc((var(--wt-space-3) + var(--wt-space-4)) / 2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface);
      }
      article[data-disputed] {
        border: 2px solid var(--wt-color-danger);
      }
      article header strong {
        font-size: calc((var(--wt-font-size-md) + var(--wt-font-size-lg)) / 2);
      }
      article time {
        font-size: calc((var(--wt-font-size-sm) + var(--wt-font-size-md)) / 2);
      }
      .dispute {
        display: grid;
        grid-template-columns: calc(3 * var(--wt-space-6)) minmax(0, 1fr);
        gap: var(--wt-space-1) var(--wt-space-2);
      }
      .dispute dt {
        overflow-wrap: anywhere;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .actions > * {
        flex: 1;
      }
      .muted,
      article time {
        color: var(--wt-color-text-muted);
      }
      [data-finished-days] {
        gap: 0;
      }
      [data-finished-days] > header {
        align-items: center;
        margin-block-start: calc(-1 * var(--wt-space-2));
      }
      [data-approve-all] {
        --wt-action-text: var(--wt-color-primary-text);
        --wt-action-font-size: var(--wt-font-size-md);
        --wt-action-padding: var(--wt-space-2) var(--wt-space-1);
      }
      .finished {
        margin: 0 calc(-1 * var(--wt-space-3));
        padding: 0;
        list-style: none;
      }
      .finished li {
        padding-block: var(--wt-space-1);
        padding-inline: var(--wt-space-4) var(--wt-space-3);
        border-block-start: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
      }
      .day-facts {
        display: grid;
        grid-template-columns: calc(3 * var(--wt-space-6)) minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--wt-space-2);
        min-block-size: calc(var(--wt-tap-min) - var(--wt-space-1));
      }
      .day-facts:has([data-edit-day]) {
        grid-template-columns: calc(3 * var(--wt-space-6)) minmax(0, 1fr) auto auto;
      }
      .day-facts time,
      .time-range,
      [data-worked] {
        text-wrap: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .day-facts small {
        display: block;
        font-size: var(--wt-font-size-sm);
      }
      .spoken-duration {
        ${visuallyHiddenStyles}
      }
    `,
  ];
  @property({ attribute: false }) api!: TillApi;
  @property({ type: Boolean, reflect: true }) active = false;
  @property() personId = "";
  @property() backLabel = "";

  @state() private queue: AttendanceManagerQueue | null = null;
  @state() private lookups: AttendanceLookups | null = null;
  @state() private reading = false;
  @state() private busy = false;
  @state() private readError = "";
  @state() private actionError = "";
  @state() private pending: AttendanceCommand | null = null;
  @state() private editor: ManagerDay | null = null;
  @state() private reasonRefusal = "";
  #lifetime = new AbortController();

  override disconnectedCallback(): void {
    this.#lifetime.abort();
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("api") || changed.has("personId")) {
      this.#lifetime.abort();
      this.#lifetime = new AbortController();
      this.queue = this.lookups = this.pending = null;
      this.editor = null;
      this.readError = this.actionError = "";
      this.reading = this.busy = false;
    }
    if (!this.active) this.editor = null;
    if (this.active && (changed.has("active") || changed.has("api") || changed.has("personId")))
      void this.refresh();
  }

  override updated(changed: PropertyValues): void {
    if (this.active && changed.has("active"))
      this.renderRoot.querySelector<HTMLElement>("[data-heading]")?.focus();
  }

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #message(error: unknown, read: boolean): string {
    const code = (error as { code?: string } | null)?.code;
    if (
      code === "session.required" ||
      code === "session.not_open" ||
      code === "session.person_not_signed_in"
    )
      this.#emit("hours-approval-session-ended");
    if (code === "attendance.state_changed" || code === "correction.not_pending")
      return t("hours.approvals_changed");
    if (
      code === "authorization.not_permitted" ||
      code === "device.forbidden_action" ||
      code === "attendance.not_permitted"
    )
      return t("hours.approvals_not_permitted");
    if (code && code !== "attendance.write_failed") return codeMessage(code);
    return t(read ? "hours.approvals_read_failed" : "hours.approvals_write_failed");
  }

  async #call<T>(
    lifetime: AbortSignal,
    operation: (options: RequestOptions) => Promise<T>,
  ): Promise<T> {
    const limit = limited(25_000, lifetime);
    try {
      return await Promise.race([
        operation({ signal: limit.signal }),
        pause(limit.signal).then(() => {
          throw new DOMException("Hours request ended", "AbortError");
        }),
      ]);
    } finally {
      limit.done();
    }
  }

  #canApprove(personId: string): boolean {
    return personId !== this.personId || this.lookups?.viewer.canSelfApprove === true;
  }

  #canSettle(item: CorrectionItem, action: "approve" | "decline"): boolean {
    if (item.status === "disputed")
      return (
        action === "approve" && item.personId !== this.personId && item.workerVersion !== undefined
      );
    if (item.status !== "waiting-manager") return false;
    return action === "approve"
      ? this.#canApprove(item.personId) && item.readyToApply
      : item.personId !== this.personId;
  }

  #name(personId: string): string {
    return (
      this.lookups?.people.find((person) => person.personId === personId)?.displayName ?? personId
    );
  }

  async refresh(): Promise<void> {
    if (!this.isConnected || this.reading) return;
    const lifetime = this.#lifetime.signal;
    this.reading = true;
    this.readError = "";
    try {
      const [queue, lookups] = await this.#call(lifetime, (options) =>
        Promise.all([
          this.api.getAttendanceManagerQueue(options),
          this.api.getAttendanceManagerLookups(options),
        ]),
      );
      if (lifetime.aborted) return;
      if (lookups.viewer.personId !== this.personId)
        throw new TypeError("Hours approvals belong to another operator");
      this.lookups = lookups;
      this.queue = queue;
      this.#emit(
        "hours-approval-count",
        queue.finishedDays.filter((day) => this.#canApprove(day.personId)).length +
          queue.items.filter(
            (item) => item.personId !== this.personId || this.#canSettle(item, "approve"),
          ).length,
      );
    } catch (error) {
      if (lifetime.aborted) return;
      this.queue = this.lookups = null;
      this.#emit("hours-approval-count", 0);
      this.readError = this.#message(error, true);
    } finally {
      if (!lifetime.aborted) this.reading = false;
    }
  }

  async #perform(operation: (lifetime: AbortSignal) => Promise<void>): Promise<void> {
    if (!this.isConnected || !this.active || this.busy || this.reading) return;
    const lifetime = this.#lifetime.signal;
    this.busy = true;
    this.actionError = this.reasonRefusal = "";
    try {
      await operation(lifetime);
    } catch (error) {
      if (lifetime.aborted) return;
      const refusal = error as { code?: string; params?: { field?: string } } | null;
      if (this.editor && refusal?.params?.field === "reason")
        this.reasonRefusal = t("attendance.check_reason");
      else this.actionError = this.#message(error, false);
      if (
        refusal?.code === "attendance.state_changed" ||
        refusal?.code === "correction.not_pending"
      ) {
        this.editor = null;
        await this.refresh();
      }
    } finally {
      if (!lifetime.aborted) this.busy = false;
    }
  }

  async #readDay(
    lifetime: AbortSignal,
    { personId, date }: DaySelection,
  ): Promise<AttendanceDayView> {
    const view = await this.#call(lifetime, (options) =>
      this.api.getAttendanceManagerDay(personId, date, options),
    );
    if (view.personId !== personId || view.date !== date)
      throw new TypeError("Hours belong to another day");
    return view;
  }

  #editDay(selection: DaySelection, item?: CorrectionItem): void {
    if (this.pending || this.editor || selection.personId === this.personId) return;
    void this.#perform(async (lifetime) => {
      const view = await this.#readDay(lifetime, selection);
      if (lifetime.aborted || !this.active) return;
      const current = view.items.find(
        ({ id, status }) => id === item?.id && status === item.status,
      );
      if (item && !current) throw { code: "attendance.state_changed" };
      this.editor = { view, item: current, name: this.#name(view.personId).split(" ")[0]! };
    });
  }

  #propose(event: CustomEvent<{ changes: AttendanceChange[]; reason: string }>): void {
    event.stopPropagation();
    const editor = this.editor;
    if (!editor || this.pending || editor.view.personId === this.personId) return;
    void this.#perform((lifetime) =>
      this.#send(lifetime, {
        action: "propose",
        commandId: crypto.randomUUID(),
        expectedRevision: editor.view.revision,
        personId: editor.view.personId,
        date: editor.view.date,
        ...(editor.item && { replaces: editor.item.id }),
        changes: event.detail.changes,
        reason: event.detail.reason,
      }),
    );
  }

  #settle(item: CorrectionItem, action: "approve" | "decline"): void {
    if (this.pending) return;
    void this.#perform(async (lifetime) => {
      const view = await this.#readDay(lifetime, {
        personId: item.personId,
        date: workerDate(item),
      });
      if (lifetime.aborted || !this.active) return;
      const current = view.items.find(
        (entry) => entry.id === item.id && entry.status === item.status,
      );
      if (!current || !this.#canSettle(current, action)) throw { code: "attendance.state_changed" };
      await this.#send(lifetime, {
        action,
        itemId: item.id,
        commandId: crypto.randomUUID(),
        expectedRevision: view.revision,
      });
    });
  }

  #approveDays(days: FinishedAttendanceDay[]): void {
    if (this.pending) return;
    void this.#perform(async (lifetime) => {
      await this.#call(lifetime, (options) =>
        this.api.approveAttendanceDays(
          days.map(({ personId, date, digest }) => ({ personId, date, digest })),
          options,
        ),
      );
      if (!lifetime.aborted) await this.refresh();
    });
  }

  async #send(lifetime: AbortSignal, command: AttendanceCommand): Promise<void> {
    this.pending = command;
    try {
      const result = await this.#call(lifetime, (options) =>
        this.api.sendAttendanceManagerCommand(command, options),
      );
      if (result.commandId !== command.commandId)
        throw new TypeError("Hours response belongs to another command");
    } catch (error) {
      if (!lifetime.aborted && !isNetworkFailure(error)) this.pending = null;
      throw error;
    }
    if (lifetime.aborted) return;
    this.pending = null;
    this.editor = null;
    await this.refresh();
  }

  #retryCommand = (): void => {
    const command = this.pending;
    if (command) void this.#perform((lifetime) => this.#send(lifetime, command));
  };

  #item(item: CorrectionItem, blocked: boolean) {
    const name = this.#name(item.personId);
    const date = workerDate(item);
    const disputed = item.status === "disputed";
    const firstName = name.split(" ")[0]!;
    const managerName = this.lookups?.people
      .find((person) => person.personId === item.requestedByPersonId)
      ?.displayName.split(" ")[0];
    const changes = item.changes.map((change) => html`<p>${changeLine(item, change, date)}</p>`);
    const reply = disputed
      ? item.history
          .filter(
            (entry) =>
              item.responseEntryIds.includes(entry.entryId) &&
              entry.correctionStatus === "disputed",
          )
          .at(-1)?.correctionReason
      : undefined;
    const workerTimes = item.workerVersion?.changes
      .map((change) => timeText(change, date))
      .join(" · ");
    return html`<article ?data-disputed=${disputed}>
      <header><strong>${name}</strong><time datetime=${date}>${shortDate(date)}</time></header>
      ${
        disputed
          ? html`<dl class="dispute">
                <dt class="muted">
                  ${
                    item.requestedByPersonId === this.personId
                      ? t("hours.you_changed")
                      : managerName
                        ? fill(t("hours.manager_changed"), { name: managerName })
                        : t("hours.manager_proposed")
                  }
                </dt>
                <dd>${changes}</dd>
                <dt class="muted">${fill(t("hours.worker_says"), { name: firstName })}</dt>
                <dd>
                  ${workerTimes}${reply ? `${workerTimes ? ": " : ""}${quotedReason(reply)}` : ""}
                </dd>
              </dl>
              <p class="muted">${t("hours.both_versions")}</p>`
          : html`${changes}
              <p class="muted">${quotedReason(item.reason)}</p>`
      }
      <div class="actions">
        ${this.#canSettle(item, "approve") ? html`<wt-button data-approve-request variant=${blocked || disputed ? "secondary" : "primary"} .disabled=${blocked} @click=${() => this.#settle(item, "approve")}>${disputed ? fill(t("hours.take_worker_time"), { name: firstName }) : t("hours.approve")}</wt-button>` : nothing}
        ${item.personId !== this.personId ? html`<wt-button variant="secondary" .disabled=${blocked} @click=${() => this.#editDay({ personId: item.personId, date }, item)}>${t("hours.edit")}</wt-button>` : nothing}
        ${this.#canSettle(item, "decline") ? html`<wt-button variant="secondary" .disabled=${blocked} @click=${() => this.#settle(item, "decline")}>${t("hours.decline")}</wt-button>` : nothing}
      </div>
    </article>`;
  }

  #renderEditor() {
    return this.editor
      ? html`<till-attendance-correction-dialog
          .open=${true}
          .managerDay=${this.editor}
          .timeZone=${this.editor.view.timeZone}
          .busy=${this.busy}
          .blocked=${this.pending !== null}
          .recovery=${this.pending ? "retry" : null}
          .error=${this.actionError}
          .reasonRefusal=${this.reasonRefusal}
          @correction-save=${this.#propose}
          @correction-cancel=${() => {
            this.editor = null;
            this.actionError = "";
          }}
          @retry-attendance-command=${this.#retryCommand}
        ></till-attendance-correction-dialog>`
      : nothing;
  }

  override render() {
    if (!this.active) return nothing;
    const { items = [], finishedDays = [] } = this.queue ?? {};
    const asked = items.filter((item) => item.status === "waiting-manager");
    const disputed = items.filter((item) => item.status === "disputed");
    const eligible = finishedDays.filter((day) => this.#canApprove(day.personId));
    const blocked = this.busy || this.reading || !!this.pending;
    return html`<wt-full-screen-panel .bodyLabel=${t("hours.approval")}>
      <section slot="header">
        <wt-top-bar
          .backLabel=${this.backLabel}
          .backDisabled=${this.busy}
          @wt-back=${() => this.#emit("hours-approval-close")}
        >
          <span slot="title" tabindex="-1" data-heading>${t("hours.approval")}</span>
        </wt-top-bar>
      </section>
      <div class="list" aria-busy=${this.reading}>
        ${this.reading && !this.queue ? html`<p role="status">${t("hours.approvals_reading")}</p>` : nothing}
        ${
          this.readError
            ? html`<p role="alert">${this.readError}</p>
                <wt-button variant="secondary" @click=${() => this.refresh()}
                  >${t("find_page.retry")}</wt-button
                >`
            : nothing
        }
        ${this.actionError ? html`<p role="alert">${this.actionError}</p>` : nothing}
        ${this.pending ? html`<wt-button variant="secondary" .disabled=${this.busy} @click=${this.#retryCommand}>${t("attendance.retry_response")}</wt-button>` : nothing}
        ${
          asked.length
            ? html`<section aria-labelledby="asked">
                <h3 id="asked">${t("hours.asked")} · ${asked.length}</h3>
                ${asked.map((item) => this.#item(item, blocked))}
              </section>`
            : nothing
        }
        ${
          disputed.length
            ? html`<section aria-labelledby="disputed">
                <h3 id="disputed">${t("hours.disputed")} · ${disputed.length}</h3>
                ${disputed.map((item) => this.#item(item, blocked))}
              </section>`
            : nothing
        }
        ${
          this.queue
            ? html`<section data-finished-days aria-labelledby="finished">
                <header>
                  <h3 id="finished">${t("hours.finished")} · ${finishedDays.length}</h3>
                  ${eligible.length ? html`<wt-button data-approve-all variant="ghost" .disabled=${blocked} @click=${() => this.#approveDays(eligible)}>${fill(t("hours.approve_all"), { count: String(eligible.length) })}</wt-button>` : nothing}
                </header>
                ${asked.length + disputed.length + finishedDays.length === 0 ? html`<p>${t("hours.no_approvals")}</p>` : nothing}
                <ul class="finished" role="list">
                  ${finishedDays.map((day) => {
                    const clock = (time: FinishedAttendanceDay["times"][number]) =>
                      storedAttendanceTime(time.at, time.offsetMinutes).slice(11, 16);
                    const starts = day.times.filter((time) => time.kind === "in");
                    const ends = day.times.filter((time) => time.kind === "out");
                    const notes = [
                      day.breakMinutes
                        ? fill(t("hours.break_minutes"), { minutes: String(day.breakMinutes) })
                        : "",
                      ends.some((time) => time.automatic) ? t("hours.automatic_out") : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    const minutes = day.workedMinutes;
                    return html`<li>
                      <div class="day-facts">
                        <strong>${this.#name(day.personId)}</strong>
                        <span>
                          <time datetime=${day.date}>${weekdayAndDay(day.date)}</time>
                          ${starts.map((start, i) => html` · <span class="time-range">${clock(start)} – ${clock(ends[i]!)}</span>`)}
                          ${notes ? html`<small class="muted">${notes}</small>` : nothing}
                        </span>
                        ${
                          minutes === undefined
                            ? nothing
                            : html`<strong data-worked>
                                <span aria-hidden="true"
                                  >${Math.floor(minutes / 60)} h
                                  ${String(minutes % 60).padStart(2, "0")}</span
                                >
                                <span class="spoken-duration"
                                  >${formatDuration(minutes * 60_000, currentLocale())}</span
                                >
                              </strong>`
                        }
                        ${
                          day.personId !== this.personId
                            ? html`<wt-icon-button
                                data-edit-day
                                icon="chevron-right"
                                .label=${fill(t("hours.edit_day"), { name: this.#name(day.personId), date: shortDate(day.date) })}
                                .disabled=${blocked}
                                @click=${() => this.#editDay(day)}
                              ></wt-icon-button>`
                            : nothing
                        }
                      </div>
                      ${
                        !this.#canApprove(day.personId)
                          ? html`<p class="muted">${t("hours.cannot_approve_own")}</p>`
                          : nothing
                      }
                    </li>`;
                  })}
                </ul>
              </section>`
            : nothing
        }
      </div>
      ${this.#renderEditor()}
    </wt-full-screen-panel>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-hours-approval-screen": TillHoursApprovalScreen;
  }
}
