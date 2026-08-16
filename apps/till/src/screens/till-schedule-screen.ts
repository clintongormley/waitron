import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { AbsenceKind, MyAbsence, MyShift, MySwap, StaffMember, TillApi } from "../api/client.js";

/** The four absence kinds, in display order — the request form's Type picker. Mirrors the server's
 * `absence_kind` enum; the server re-validates. */
const ABSENCE_KINDS: readonly AbsenceKind[] = ["holiday", "sick_leave", "leave", "unpaid"];

/** How far ahead "my upcoming shifts" looks (a fixed default window; a wider range / pagination is a
 * recorded follow-up). */
const WINDOW_DAYS = 14;

/** A `YYYY-MM-DD` string for `date` in UTC — the wire format the schedule window bounds use. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
 * The STAFF-FACING schedule screen (menu of my shifts / swaps / time off), reachable from the counter's
 * "My schedule" control. It is the request half of shift swaps and absences: a logged-in operator can
 * view their own upcoming shifts, accept a swap offered to them, offer one of their shifts to a
 * colleague, and request time off. The requester is ALWAYS the session's operator server-side; these
 * forms never send a personId (the client methods don't carry one).
 *
 * Loads its three lists on connect and after every successful action. A rejected `{ code }` surfaces as
 * a non-fatal banner via `codeMessage` (never the raw code); the operator stays on the screen and can
 * retry. Lit + `@waitron/ui` primitives + `baseStyles`, HA-free (the till's own design system).
 */
@customElement("till-schedule-screen")
export class TillScheduleScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }

      .title {
        margin: 0;
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }

      .notice {
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
      }

      .status {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      section {
        margin-bottom: var(--wt-space-5);
      }

      h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      ul {
        margin: 0;
        padding: 0;
        list-style: none;
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
      }

      .meta {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
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
      }

      .field label {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      select {
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }
    `,
  ];

  /** The HTTP face of the till. Set before the element connects (its lifecycle loads the schedule). */
  @property({ attribute: false }) api!: TillApi;
  /** The active staff roster, for the colleague picker and to name a swap's requester. */
  @property({ attribute: false }) staff: StaffMember[] = [];
  /** The logged-in operator's person id — filtered out of the colleague picker (you cannot offer to
   * yourself) and used to skip your own name when resolving a requester. */
  @property() operatorPersonId = "";

  /** The three lists: `undefined` while first loading, then the (possibly empty) rows. */
  @state() private shifts?: MyShift[];
  @state() private swaps?: MySwap[];
  @state() private absences?: MyAbsence[];
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
    void this.#reload();
  }

  /** The half-open `[from, to)` window for the shifts read: today through today + {@link WINDOW_DAYS}. */
  #window(): { from: string; to: string } {
    const now = new Date();
    const to = new Date(now);
    to.setUTCDate(to.getUTCDate() + WINDOW_DAYS);
    return { from: isoDate(now), to: isoDate(to) };
  }

  /**
   * (Re)load all three lists. State written after a mid-load disconnect is harmless — Lit never paints
   * a detached element — so no `isConnected` guard is needed (the `till-lock-screen` reasoning). A
   * rejection leaves a load-failed status rather than an unhandled promise.
   */
  async #reload(): Promise<void> {
    const { from, to } = this.#window();
    try {
      const [shifts, swaps, absences] = await Promise.all([
        this.api.listMyShifts(from, to),
        this.api.listMySwaps(),
        this.api.listMyAbsences(),
      ]);
      this.shifts = shifts;
      this.swaps = swaps;
      this.absences = absences;
      this.loadFailed = false;
    } catch {
      this.loadFailed = true;
      // Clear the loading state so the load-failed status shows rather than a stuck spinner.
      this.shifts ??= [];
      this.swaps ??= [];
      this.absences ??= [];
    }
  }

  /** Run an action guarded by `busy`, surfacing a rejected `{ code }` as a non-fatal banner (never the
   * raw code) and reloading on success so the lists reflect the change. */
  async #act(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.noticeCode = undefined;
    try {
      await fn();
      await this.#reload();
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

  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-counter", { bubbles: true, composed: true }));
  }

  /** A colleague's display name from the roster, or the raw id if not on it (a defensive fallback). */
  #personName(personId: string): string {
    return this.staff.find((s) => s.personId === personId)?.displayName ?? personId;
  }

  /** A one-line label for a shift: local wall date, time range and role. */
  #shiftLabel(shift: MyShift): string {
    const start = wallClock(shift.startsAt, shift.startsOffsetMinutes);
    const end = wallClock(shift.endsAt, shift.endsOffsetMinutes);
    const time = `${start.date} ${start.time}–${end.time}`;
    return shift.role ? `${time} · ${shift.role}` : time;
  }

  override render() {
    return html`
      <wt-card class="screen">
        <header class="head">
          <h1 class="title">${t("schedule.title")}</h1>
          <wt-button class="back" variant="secondary" @click=${() => this.#back()}>
            ${t("schedule.back")}
          </wt-button>
        </header>
        ${this.noticeCode
          ? html`<p class="notice" role="alert">${codeMessage(this.noticeCode)}</p>`
          : nothing}
        ${this.#body()}
      </wt-card>
    `;
  }

  #body() {
    if (this.shifts === undefined) {
      return html`<p class="status">${t("schedule.loading")}</p>`;
    }
    return html`
      ${this.loadFailed
        ? html`<p class="status notice" role="alert">${t("schedule.load_failed")}</p>`
        : nothing}
      ${this.#shiftsSection()} ${this.#swapsSection()} ${this.#coverSection()}
      ${this.#absencesSection()} ${this.#absenceForm()}
    `;
  }

  #shiftsSection() {
    const shifts = this.shifts ?? [];
    return html`<section class="shifts">
      <h2>${t("schedule.shifts_title")}</h2>
      ${shifts.length === 0
        ? html`<p class="status">${t("schedule.shifts_empty")}</p>`
        : html`<ul>
            ${shifts.map(
              (shift) => html`<li class="shift" data-shift=${shift.id}>
                <span>${this.#shiftLabel(shift)}</span>
              </li>`,
            )}
          </ul>`}
    </section>`;
  }

  #swapsSection() {
    // Only swaps offered TO me that I can still act on — the Accept subset (design).
    const offered = (this.swaps ?? []).filter(
      (s) => s.direction === "offered_to_me" && s.status === "requested",
    );
    return html`<section class="swaps">
      <h2>${t("schedule.swaps_title")}</h2>
      ${offered.length === 0
        ? html`<p class="status">${t("schedule.swaps_empty")}</p>`
        : html`<ul>
            ${offered.map(
              (swap) => html`<li class="swap" data-swap=${swap.id}>
                <span class="meta">${this.#personName(swap.requestedByPersonId)}</span>
                <wt-button
                  class="accept"
                  variant="primary"
                  ?disabled=${this.busy}
                  @click=${() => this.#accept(swap.id)}
                >
                  ${t("schedule.accept")}
                </wt-button>
              </li>`,
            )}
          </ul>`}
    </section>`;
  }

  #coverSection() {
    const shifts = this.shifts ?? [];
    const colleagues = this.staff.filter((s) => s.personId !== this.operatorPersonId);
    return html`<section class="cover">
      <h2>${t("schedule.cover_title")}</h2>
      <div class="form">
        <div class="field">
          <label for="cover-shift">${t("schedule.cover_shift")}</label>
          <select
            id="cover-shift"
            class="cover-shift"
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
          <label for="cover-colleague">${t("schedule.cover_colleague")}</label>
          <select
            id="cover-colleague"
            class="cover-colleague"
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
          class="cover-submit"
          variant="primary"
          ?disabled=${this.busy || this.coverShiftId === "" || this.coverColleagueId === ""}
          @click=${() => this.#submitCover()}
        >
          ${t("schedule.cover_submit")}
        </wt-button>
      </div>
    </section>`;
  }

  #absencesSection() {
    const absences = this.absences ?? [];
    return html`<section class="absences">
      <h2>${t("schedule.absences_title")}</h2>
      ${absences.length === 0
        ? html`<p class="status">${t("schedule.absences_empty")}</p>`
        : html`<ul>
            ${absences.map(
              (absence) => html`<li class="absence" data-absence=${absence.id}>
                <span>${t(`schedule.kind.${absence.kind}`)} · ${absence.startsOn} – ${absence.endsOn}</span>
                <span class="meta">${t(`schedule.status.${absence.status}`)}</span>
              </li>`,
            )}
          </ul>`}
    </section>`;
  }

  #absenceForm() {
    return html`<section class="request-absence">
      <h2>${t("schedule.absence_title")}</h2>
      <div class="form">
        <div class="field">
          <label for="abs-kind">${t("schedule.absence_kind")}</label>
          <select
            id="abs-kind"
            class="abs-kind"
            .value=${this.absKind}
            @change=${(e: Event) =>
              (this.absKind = (e.target as HTMLSelectElement).value as AbsenceKind)}
          >
            ${ABSENCE_KINDS.map(
              (kind) => html`<option value=${kind}>${t(`schedule.kind.${kind}`)}</option>`,
            )}
          </select>
        </div>
        <wt-input
          class="abs-from"
          type="date"
          .label=${t("schedule.absence_from")}
          .value=${this.absFrom}
          @wt-change=${(e: Event) => {
            e.stopPropagation();
            this.absFrom = (e as CustomEvent<{ value: string }>).detail.value;
          }}
        ></wt-input>
        <wt-input
          class="abs-to"
          type="date"
          .label=${t("schedule.absence_to")}
          .value=${this.absTo}
          @wt-change=${(e: Event) => {
            e.stopPropagation();
            this.absTo = (e as CustomEvent<{ value: string }>).detail.value;
          }}
        ></wt-input>
        <wt-input
          class="abs-note"
          .label=${t("schedule.absence_note")}
          .value=${this.absNote}
          @wt-change=${(e: Event) => {
            e.stopPropagation();
            this.absNote = (e as CustomEvent<{ value: string }>).detail.value;
          }}
        ></wt-input>
        <wt-button
          class="abs-submit"
          variant="primary"
          ?disabled=${this.busy || this.absFrom === "" || this.absTo === ""}
          @click=${() => this.#submitAbsence()}
        >
          ${t("schedule.absence_submit")}
        </wt-button>
      </div>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-schedule-screen": TillScheduleScreen;
  }
}
