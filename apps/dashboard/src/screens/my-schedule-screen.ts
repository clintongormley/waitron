import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  absenceKindName,
  absenceStatusName,
  swapDirectionName,
  swapStatusName,
} from "../i18n/domain.js";
import { selectStyles } from "../select-styles.js";
import type {
  AbsenceKind,
  DashboardApi,
  MyAbsence,
  MyShift,
  MySwap,
  RosterEntry,
} from "../api/client.js";

/** The four absence kinds, in display order — the request form's Type picker. Mirrors the server's
 * `absence_kind` enum; the server re-validates. */
const ABSENCE_KINDS: readonly AbsenceKind[] = ["holiday", "sick_leave", "leave", "unpaid"];

/** How far ahead "my upcoming shifts" looks (a fixed default window; a wider range / pagination is a
 * recorded follow-up). */
const WINDOW_DAYS = 14;

/**
 * The half-open `[from, to)` window of dates for the shifts read: `now`'s day through it plus `days`,
 * both `YYYY-MM-DD`. Computed in UTC — the dashboard's own `date-utils.ts` convention (`today()` is
 * UTC; seeding from the venue's local timezone is a deferred slice), so a shift is placed by its UTC
 * day. Exported for a direct unit test rather than exercised only through the async load.
 */
export function scheduleWindow(now: Date, days: number): { from: string; to: string } {
  const to = new Date(now.getTime() + days * 86_400_000);
  return { from: now.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * The LOCAL wall date+time of an instant, recovered by shifting the UTC instant by its stored wall
 * offset and reading the UTC components — the same `(instant + offset)` recovery the server's window
 * uses. Offset 0 (this slice's shifts) leaves it equal to the UTC clock.
 */
function wallClock(iso: string, offsetMinutes: number): { date: string; time: string } {
  const shifted = new Date(Date.parse(iso) + offsetMinutes * 60_000);
  return { date: shifted.toISOString().slice(0, 10), time: shifted.toISOString().slice(11, 16) };
}

/**
 * The STAFF SELF-SERVICE screen — the `staff`-role landing face of the management dashboard, the browser
 * twin of `apps/till`'s till-schedule screen. A staff member views their own upcoming shifts, accepts a
 * swap offered to them, offers one of their shifts to a colleague, and requests / reviews time off. The
 * requester is ALWAYS the session's person server-side (`apps/server/src/me-api.ts`); these forms never
 * send a personId — the client methods don't carry one.
 *
 * Loads its three lists (plus the roster, for the colleague picker and requester names) on connect and
 * after every successful action. A rejected `{ code }` surfaces as a non-fatal banner via `codeMessage`
 * (never the raw code); the operator stays on the screen and can retry. Lit + `@waitron/ui` primitives +
 * `baseStyles`, the dashboard's own design system.
 */
@customElement("dashboard-my-schedule-screen")
export class MyScheduleScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 12rem;
      }

      .field label {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      .notice {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-danger);
      }
    `,
  ];

  /** The HTTP face of the dashboard. Set before the element connects (its lifecycle loads the schedule). */
  @property({ attribute: false }) api!: DashboardApi;
  /** The logged-in person's id (from the shell's `getMe`) — filtered out of the colleague picker (you
   * cannot offer to yourself) and used to name a swap's OTHER party. */
  @property() myPersonId = "";

  /** The three lists: `undefined` while first loading, then the (possibly empty) rows. */
  @state() private shifts?: MyShift[];
  @state() private swaps?: MySwap[];
  @state() private absences?: MyAbsence[];
  /** The active roster, for the colleague picker and to name a swap's counterparty. */
  @state() private roster: RosterEntry[] = [];
  /** Set when the initial load rejected — shows a load-failed status instead of a stuck spinner. */
  @state() private loadFailed = false;
  /** The error CODE of a non-fatal banner (rendered via `codeMessage`), or undefined for none. */
  @state() private noticeCode?: string;
  /** A request is in flight — disables the action controls (a single-flight/hygiene guard). */
  @state() private busy = false;

  /** Offer-a-shift form: which of my shifts, and to which colleague. */
  @state() private coverShiftId = "";
  @state() private coverColleagueId = "";
  /** Request-time-off form. */
  @state() private absKind: AbsenceKind = "holiday";
  @state() private absFrom = "";
  @state() private absTo = "";
  @state() private absNote = "";

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** The half-open `[from, to)` window for the shifts read: today through today + {@link WINDOW_DAYS}. */
  #window(): { from: string; to: string } {
    return scheduleWindow(new Date(), WINDOW_DAYS);
  }

  /**
   * The INITIAL load: the roster (for the colleague picker + name resolution) ONCE, then all three
   * lists — mirrors approvals-screen's `#load` (static data) vs `#loadLists` (the reloadable part)
   * split, so an action reload never refetches the roster (a swap/absence cannot change the active
   * roster). A rejection anywhere leaves a load-failed status rather than an unhandled promise. State
   * written after a mid-load disconnect is harmless — Lit never paints a detached element.
   */
  async #load(): Promise<void> {
    try {
      this.roster = await this.api.getStaffRoster();
      await this.#loadLists();
      this.loadFailed = false;
    } catch {
      this.loadFailed = true;
      // Clear the loading state so the load-failed status shows rather than a stuck spinner.
      this.shifts ??= [];
      this.swaps ??= [];
      this.absences ??= [];
    }
  }

  /** Reload just the three lists (not the roster). Throws to its caller's catch. */
  async #loadLists(): Promise<void> {
    const { from, to } = this.#window();
    const [shifts, swaps, absences] = await Promise.all([
      this.api.listMyShifts(from, to),
      this.api.listMySwaps(),
      this.api.listMyAbsences(),
    ]);
    this.shifts = shifts;
    this.swaps = swaps;
    this.absences = absences;
  }

  /** Run an action guarded by `busy`, surfacing a rejected `{ code }` as a non-fatal banner (never the
   * raw code) and reloading the lists on success so they reflect the change (the roster is unchanged, so
   * it is not refetched). */
  async #act(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.noticeCode = undefined;
    try {
      await fn();
      await this.#loadLists();
    } catch (error) {
      this.noticeCode = (error as { code?: string }).code ?? "server.internal";
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

  /** A person's display name from the roster, or the raw id if not on it (a defensive fallback). */
  #personName(personId: string): string {
    return this.roster.find((r) => r.personId === personId)?.displayName ?? personId;
  }

  /** A one-line label for a shift: local wall date, time range and role. */
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
    if (this.shifts === undefined) {
      return html`<p class="muted" data-test="loading">${t("myschedule.loading")}</p>`;
    }
    return html`
      ${
        this.loadFailed
          ? html`<p class="notice" role="alert" data-test="load-failed">
              ${t("myschedule.load_failed")}
            </p>`
          : nothing
      }
      ${this.#shiftsSection()} ${this.#swapsSection()} ${this.#coverSection()}
      ${this.#absencesSection()} ${this.#absenceForm()}
    `;
  }

  #shiftsSection(): TemplateResult {
    const shifts = this.shifts ?? [];
    return html`<section class="shifts" aria-labelledby="shifts-h">
      <h2 id="shifts-h">${t("myschedule.shifts_title")}</h2>
      ${
        shifts.length === 0
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
    const swaps = this.swaps ?? [];
    return html`<section class="swaps" aria-labelledby="swaps-h">
      <h2 id="swaps-h">${t("myschedule.swaps_title")}</h2>
      ${
        swaps.length === 0
          ? html`<p class="muted" data-test="swaps-empty">${t("myschedule.swaps_empty")}</p>`
          : html`<ul>
              ${swaps.map((swap) => this.#swapRow(swap))}
            </ul>`
      }
    </section>`;
  }

  /** One swap row: the counterparty + which side I'm on + its status, and — for a swap offered to me
   * that is still `requested` — an Accept. */
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
    const colleagues = this.roster.filter((r) => r.personId !== this.myPersonId);
    return html`<section class="cover" aria-labelledby="cover-h">
      <h2 id="cover-h">${t("myschedule.cover_title")}</h2>
      <div class="form">
        <div class="field">
          <label for="cover-shift">${t("myschedule.cover_shift")}</label>
          <select
            id="cover-shift"
            data-test="cover-shift"
            .value=${this.coverShiftId}
            @change=${(e: Event) => (this.coverShiftId = (e.target as HTMLSelectElement).value)}
          >
            <option value="">—</option>
            ${shifts.map(
              (shift) => html`<option value=${shift.id}>${this.#shiftLabel(shift)}</option>`,
            )}
          </select>
        </div>
        <div class="field">
          <label for="cover-colleague">${t("myschedule.cover_colleague")}</label>
          <select
            id="cover-colleague"
            data-test="cover-colleague"
            .value=${this.coverColleagueId}
            @change=${(e: Event) => (this.coverColleagueId = (e.target as HTMLSelectElement).value)}
          >
            <option value="">—</option>
            ${colleagues.map(
              (person) => html`<option value=${person.personId}>${person.displayName}</option>`,
            )}
          </select>
        </div>
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
    const absences = this.absences ?? [];
    return html`<section class="absences" aria-labelledby="absences-h">
      <h2 id="absences-h">${t("myschedule.absences_title")}</h2>
      ${
        absences.length === 0
          ? html`<p class="muted" data-test="absences-empty">${t("myschedule.absences_empty")}</p>`
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
        <div class="field">
          <label for="abs-kind">${t("myschedule.absence_kind")}</label>
          <select
            id="abs-kind"
            data-test="abs-kind"
            .value=${this.absKind}
            @change=${(e: Event) =>
              (this.absKind = (e.target as HTMLSelectElement).value as AbsenceKind)}
          >
            ${ABSENCE_KINDS.map(
              (kind) => html`<option value=${kind}>${absenceKindName(kind)}</option>`,
            )}
          </select>
        </div>
        <wt-input
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
