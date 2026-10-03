import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { wallClock } from "../date-utils.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import {
  absenceKindName,
  absenceStatusName,
  swapDirectionName,
  swapStatusName,
} from "../i18n/domain.js";
import type {
  AbsenceKind,
  DashboardApi,
  MyAbsence,
  MyShift,
  MySwap,
  RosterEntry,
} from "../api/client.js";

const ABSENCE_KINDS: readonly AbsenceKind[] = ["holiday", "sick_leave", "leave", "unpaid"];

const WINDOW_DAYS = 14;

type ScheduleRead = "roster" | "shifts" | "swaps" | "absences";

/** A half-open `[from, to)` window, computed in UTC, so a shift is placed by its UTC day. */
export function scheduleWindow(now: Date, days: number): { from: string; to: string } {
  const to = new Date(now.getTime() + days * 86_400_000);
  return { from: now.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * A staff member's own shifts, swaps and time off. The server takes the requester from the session
 * (`apps/server/src/me-api.ts`), so these forms never send the requester's id.
 */
@customElement("dashboard-my-schedule-screen")
export class MyScheduleScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }

      h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }

      section {
        margin-bottom: var(--wt-space-5);
      }

      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-text);
      }

      .meta {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .muted {
        color: var(--wt-color-text-muted);
      }

      .form {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-3);
      }

      .form wt-combobox {
        flex: 0 1 calc(var(--wt-space-6) * 7);
        min-width: 0;
      }

      .form wt-combobox[name="cover-shift"] {
        flex-basis: calc(var(--wt-space-6) * 10);
      }

      .notice {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-danger);
      }

      .retry {
        margin-bottom: var(--wt-space-5);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  /** One controller per read, because a controller's error callback does not say which read failed,
   * and a later live refresh can fail or succeed for one list alone. */
  readonly #roster = this.#reads("roster");
  readonly #shifts = this.#reads("shifts");
  readonly #swaps = this.#reads("swaps");
  readonly #absences = this.#reads("absences");
  @property() myPersonId = "";

  @state() private shifts?: MyShift[];
  @state() private swaps?: MySwap[];
  @state() private absences?: MyAbsence[];
  @state() private roster: RosterEntry[] = [];
  @state() private failed: ReadonlySet<ScheduleRead> = new Set();
  @state() private noticeCode?: string;
  @state() private busy = false;
  #listsStarted = false;

  @state() private coverShiftId = "";
  @state() private coverColleagueId = "";
  @state() private absKind: AbsenceKind = "holiday";
  @state() private absFrom = "";
  @state() private absTo = "";
  @state() private absNote = "";

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  #reads(read: ScheduleRead): DashboardQueries {
    return new DashboardQueries(
      this,
      () => this.api,
      () => {
        this.failed = new Set(this.failed).add(read);
      },
    );
  }

  #loaded(read: ScheduleRead): void {
    if (!this.failed.has(read)) return;
    const failed = new Set(this.failed);
    failed.delete(read);
    this.failed = failed;
  }

  #retry(): void {
    this.failed = new Set();
    void this.#load();
  }

  #window(): { from: string; to: string } {
    return scheduleWindow(new Date(), WINDOW_DAYS);
  }

  /** The roster loads only here: an action reloads just the lists, since a swap or absence cannot
   * change the roster. The lists start from the roster's delivery, not after the await: a failed
   * first read leaves the roster watched, and a later refresh can still deliver it. An action that
   * already started them this load is not repeated. */
  async #load(): Promise<void> {
    this.#listsStarted = false;
    try {
      await this.#roster.watch("getStaffRoster", [], (value) => {
        this.#loaded("roster");
        this.roster = value;
        if (!this.#colleagues().some((person) => person.personId === this.coverColleagueId)) {
          this.coverColleagueId = "";
        }
        if (!this.#listsStarted) {
          this.#loadLists().catch(() => {
            // The failed list's own controller has already recorded it in `failed`.
          });
        }
      });
    } catch {
      // The failed read's own controller has already recorded it in `failed`.
    }
  }

  #colleagues(): RosterEntry[] {
    return this.roster.filter((person) => person.personId !== this.myPersonId);
  }

  async #loadLists(): Promise<void> {
    this.#listsStarted = true;
    const { from, to } = this.#window();
    await Promise.all([
      this.#shifts.watch("listMyShifts", [from, to], (value) => {
        this.#loaded("shifts");
        this.shifts = value;
        if (!value.some((shift) => shift.id === this.coverShiftId)) this.coverShiftId = "";
      }),
      this.#swaps.watch("listMySwaps", [], (value) => {
        this.#loaded("swaps");
        this.swaps = value;
      }),
      this.#absences.watch("listMyAbsences", [], (value) => {
        this.#loaded("absences");
        this.absences = value;
      }),
    ]);
  }

  async #act(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.noticeCode = undefined;
    try {
      await fn();
      await this.#loadLists();
    } catch (error) {
      this.noticeCode = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  #accept(swapId: string): void {
    void this.#act(() => this.api.acceptSwap(swapId));
  }

  #submitCover(): void {
    if (this.coverShiftId === "" || this.coverColleagueId === "") return;
    void this.#act(async () => {
      await this.api.requestSwap({
        fromShiftId: this.coverShiftId,
        toPersonId: this.coverColleagueId,
        toShiftId: null,
      });
      this.coverShiftId = "";
      this.coverColleagueId = "";
    });
  }

  #submitAbsence(): void {
    if (this.absFrom === "" || this.absTo === "") return;
    void this.#act(async () => {
      await this.api.requestAbsence({
        kind: this.absKind,
        startsOn: this.absFrom,
        endsOn: this.absTo,
        note: this.absNote === "" ? null : this.absNote,
      });
      this.absFrom = "";
      this.absTo = "";
      this.absNote = "";
    });
  }

  #personName(personId: string): string {
    return this.roster.find((r) => r.personId === personId)?.displayName ?? personId;
  }

  #shiftLabel(shift: MyShift): string {
    const start = wallClock(shift.startsAt, shift.startsOffsetMinutes);
    const end = wallClock(shift.endsAt, shift.endsOffsetMinutes);
    const time = `${start.date} ${start.time}–${end.time}`;
    return shift.role ? `${time} · ${shift.role}` : time;
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("myschedule.title")}</h1>
      ${
        this.noticeCode
          ? html`<p class="notice" role="alert" data-test="notice">
              ${codeMessage(this.noticeCode)}
            </p>`
          : nothing
      }
      ${this.#body()}
    `;
  }

  #body(): TemplateResult {
    if (this.shifts === undefined && this.failed.size === 0) {
      return html`<p class="muted" role="status" data-test="loading">
        ${t("myschedule.loading")}
      </p>`;
    }
    return html`
      ${
        this.failed.size > 0
          ? html`<p class="notice" role="alert" data-test="load-failed">
                ${t("myschedule.load_failed")}
              </p>
              <wt-button
                class="retry"
                variant="secondary"
                data-test="retry"
                @click=${() => this.#retry()}
                >${t("myschedule.retry")}</wt-button
              >`
          : nothing
      }
      ${this.#shiftsSection()} ${this.#swapsSection()} ${this.#coverSection()}
      ${this.#absencesSection()} ${this.#absenceForm()}
    `;
  }

  #listFailed(read: ScheduleRead, message: string): TemplateResult | typeof nothing {
    return this.failed.has(read)
      ? html`<p class="notice" role="alert" data-test=${`${read}-failed`}>${message}</p>`
      : nothing;
  }

  #shiftsSection(): TemplateResult {
    const shifts = this.shifts;
    return html`<section class="shifts" aria-labelledby="shifts-h">
      <h2 id="shifts-h">${t("myschedule.shifts_title")}</h2>
      ${this.#listFailed("shifts", t("myschedule.shifts_failed"))}
      ${
        shifts === undefined
          ? nothing
          : shifts.length === 0
            ? html`<p class="muted" data-test="shifts-empty">${t("myschedule.shifts_empty")}</p>`
            : html`<ul>
                ${shifts.map(
                  (shift) =>
                    html`<li data-test=${`shift-${shift.id}`}>
                      <span>${this.#shiftLabel(shift)}</span>
                    </li>`,
                )}
              </ul>`
      }
    </section>`;
  }

  #swapsSection(): TemplateResult {
    const swaps = this.swaps;
    return html`<section class="swaps" aria-labelledby="swaps-h">
      <h2 id="swaps-h">${t("myschedule.swaps_title")}</h2>
      ${this.#listFailed("swaps", t("myschedule.swaps_failed"))}
      ${
        swaps === undefined
          ? this.failed.size > 0
            ? nothing
            : html`<p class="muted" role="status" data-test="swaps-loading">
                ${t("myschedule.loading")}
              </p>`
          : swaps.length === 0
            ? html`<p class="muted" data-test="swaps-empty">${t("myschedule.swaps_empty")}</p>`
            : html`<ul>
                ${swaps.map((swap) => this.#swapRow(swap))}
              </ul>`
      }
    </section>`;
  }

  #swapRow(swap: MySwap): TemplateResult {
    const other =
      swap.direction === "offered_to_me"
        ? this.#personName(swap.requestedByPersonId)
        : this.#personName(swap.toPersonId);
    const acceptable = swap.direction === "offered_to_me" && swap.status === "requested";
    return html`<li data-test=${`swap-${swap.id}`}>
      <span
        >${other} ·
        <span class="meta"
          >${swapDirectionName(swap.direction)} · ${swapStatusName(swap.status)}</span
        ></span
      >
      ${
        acceptable
          ? html`<wt-button
              variant="primary"
              data-test=${`accept-${swap.id}`}
              ?disabled=${this.busy}
              @click=${() => this.#accept(swap.id)}
              >${t("myschedule.accept")}</wt-button
            >`
          : nothing
      }
    </li>`;
  }

  #coverSection(): TemplateResult {
    const shifts = this.shifts ?? [];
    const colleagues = this.#colleagues();
    return html`<section class="cover" aria-labelledby="cover-h">
      <h2 id="cover-h">${t("myschedule.cover_title")}</h2>
      <div class="form">
        <wt-combobox
          name="cover-shift"
          data-test="cover-shift"
          label=${t("myschedule.cover_shift")}
          search="auto"
          placeholder="—"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${[
            { value: "", label: "—" },
            ...shifts.map((shift) => ({ value: shift.id, label: this.#shiftLabel(shift) })),
          ]}
          .value=${this.coverShiftId}
          @wt-change=${(e: CustomEvent<{ value: string }>) => (this.coverShiftId = e.detail.value)}
        ></wt-combobox>
        <wt-combobox
          name="cover-colleague"
          data-test="cover-colleague"
          label=${t("myschedule.cover_colleague")}
          search="auto"
          placeholder="—"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${[
            { value: "", label: "—" },
            ...colleagues.map((person) => ({ value: person.personId, label: person.displayName })),
          ]}
          .value=${this.coverColleagueId}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            (this.coverColleagueId = e.detail.value)}
        ></wt-combobox>
        <wt-button
          variant="primary"
          data-test="cover-submit"
          ?disabled=${this.busy || this.coverShiftId === "" || this.coverColleagueId === ""}
          @click=${() => this.#submitCover()}
          >${t("myschedule.cover_submit")}</wt-button
        >
      </div>
    </section>`;
  }

  #absencesSection(): TemplateResult {
    const absences = this.absences;
    return html`<section class="absences" aria-labelledby="absences-h">
      <h2 id="absences-h">${t("myschedule.absences_title")}</h2>
      ${this.#listFailed("absences", t("myschedule.absences_failed"))}
      ${
        absences === undefined
          ? this.failed.size > 0
            ? nothing
            : html`<p class="muted" role="status" data-test="absences-loading">
                ${t("myschedule.loading")}
              </p>`
          : absences.length === 0
            ? html`<p class="muted" data-test="absences-empty">
                ${t("myschedule.absences_empty")}
              </p>`
            : html`<ul>
                ${absences.map(
                  (absence) =>
                    html`<li data-test=${`absence-${absence.id}`}>
                      <span
                        >${absenceKindName(absence.kind)} ·
                        ${absence.startsOn}–${absence.endsOn}</span
                      >
                      <span class="meta">${absenceStatusName(absence.status)}</span>
                    </li>`,
                )}
              </ul>`
      }
    </section>`;
  }

  #absenceForm(): TemplateResult {
    return html`<section class="request-absence" aria-labelledby="request-absence-h">
      <h2 id="request-absence-h">${t("myschedule.absence_title")}</h2>
      <div class="form">
        <wt-combobox
          name="abs-kind"
          data-test="abs-kind"
          label=${t("myschedule.absence_kind")}
          search="auto"
          .options=${ABSENCE_KINDS.map((kind) => ({ value: kind, label: absenceKindName(kind) }))}
          .value=${this.absKind}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            (this.absKind = e.detail.value as AbsenceKind)}
        ></wt-combobox>
        <wt-input
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=abs-submit]"))}
          name="abs-from"
          data-test="abs-from"
          type="date"
          .label=${t("myschedule.absence_from")}
          .value=${this.absFrom}
          @wt-change=${(e: Event) => {
            e.stopPropagation();
            this.absFrom = (e as CustomEvent<{ value: string }>).detail.value;
          }}
        ></wt-input>
        <wt-input
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=abs-submit]"))}
          name="abs-to"
          data-test="abs-to"
          type="date"
          .label=${t("myschedule.absence_to")}
          .value=${this.absTo}
          @wt-change=${(e: Event) => {
            e.stopPropagation();
            this.absTo = (e as CustomEvent<{ value: string }>).detail.value;
          }}
        ></wt-input>
        <wt-input
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=abs-submit]"))}
          name="abs-note"
          data-test="abs-note"
          .label=${t("myschedule.absence_note")}
          .value=${this.absNote}
          @wt-change=${(e: Event) => {
            e.stopPropagation();
            this.absNote = (e as CustomEvent<{ value: string }>).detail.value;
          }}
        ></wt-input>
        <wt-button
          variant="primary"
          data-test="abs-submit"
          ?disabled=${this.busy || this.absFrom === "" || this.absTo === ""}
          @click=${() => this.#submitAbsence()}
          >${t("myschedule.absence_submit")}</wt-button
        >
      </div>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-my-schedule-screen": MyScheduleScreen;
  }
}
