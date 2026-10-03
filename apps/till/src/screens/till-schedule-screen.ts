import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { type ComboboxOption, submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type {
  AbsenceKind,
  MyAbsence,
  MyShift,
  MySwap,
  StaffMember,
  TillApi,
} from "../api/client.js";

/** Mirrors the server's `absence_kind` enum; the server re-validates. */
const ABSENCE_KINDS: readonly AbsenceKind[] = ["holiday", "sick_leave", "leave", "unpaid"];

const WINDOW_DAYS = 14;

const NONE: ComboboxOption = { value: "", label: "—" };

/**
 * `date`'s LOCAL calendar day as `YYYY-MM-DD`. The till sits at the venue, and the server compares the
 * window against each shift's local wall date. Not `toISOString()`, which is UTC and near local
 * midnight names a different day.
 */
export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The half-open `[from, to)` window of LOCAL dates for the shifts read. */
export function scheduleWindow(now: Date, days: number): { from: string; to: string } {
  const to = new Date(now);
  to.setDate(to.getDate() + days);
  return { from: localIsoDate(now), to: localIsoDate(to) };
}

/**
 * The LOCAL wall date+time of an instant, recovered by shifting the UTC instant by its stored wall
 * offset and reading the UTC components — the same `(instant + offset)` recovery the server's window
 * uses.
 */
function wallClock(iso: string, offsetMinutes: number): { date: string; time: string } {
  const shifted = new Date(Date.parse(iso) + offsetMinutes * 60_000);
  return { date: shifted.toISOString().slice(0, 10), time: shifted.toISOString().slice(11, 16) };
}

/**
 * The STAFF-FACING schedule screen. The server takes the requester of every action from the session,
 * never from the request body.
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

      .form wt-combobox {
        flex: 0 1 calc(var(--wt-space-6) * 7);
        min-width: 0;
      }

      .form wt-combobox[name="cover-shift"] {
        flex-basis: calc(var(--wt-space-6) * 10);
      }
    `,
  ];

  /** The HTTP face of the till. Set before the element connects (its lifecycle loads the schedule). */
  @property({ attribute: false }) api!: TillApi;
  @property({ attribute: false }) staff: StaffMember[] = [];
  @property() operatorPersonId = "";

  /** The three lists: `undefined` until a load succeeds, then the (possibly empty) rows. */
  @state() private shifts?: MyShift[];
  @state() private swaps?: MySwap[];
  @state() private absences?: MyAbsence[];
  @state() private loadFailed = false;
  @state() private noticeCode?: string;
  @state() private busy = false;

  @state() private coverShiftId = "";
  @state() private coverColleagueId = "";
  @state() private absKind: AbsenceKind = "holiday";
  @state() private absFrom = "";
  @state() private absTo = "";
  @state() private absNote = "";

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#reload();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (
      (changed.has("staff") || changed.has("operatorPersonId")) &&
      !this.#colleagues().some((person) => person.personId === this.coverColleagueId)
    ) {
      this.coverColleagueId = "";
    }
  }

  #colleagues(): StaffMember[] {
    return this.staff.filter((s) => s.personId !== this.operatorPersonId);
  }

  #window(): { from: string; to: string } {
    return scheduleWindow(new Date(), WINDOW_DAYS);
  }

  /** State written after a mid-load disconnect is harmless, so no `isConnected` guard is needed. */
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
      if (!shifts.some((shift) => shift.id === this.coverShiftId)) this.coverShiftId = "";
    } catch {
      this.loadFailed = true;
    }
  }

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

  #personName(personId: string): string {
    return this.staff.find((s) => s.personId === personId)?.displayName ?? personId;
  }

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
        ${
          this.noticeCode
            ? html`<p class="notice" role="alert">${codeMessage(this.noticeCode)}</p>`
            : nothing
        }
        ${this.#body()}
      </wt-card>
    `;
  }

  #body() {
    if (this.shifts === undefined && !this.loadFailed) {
      return html`<p class="status" role="status">${t("schedule.loading")}</p>`;
    }
    return html`
      ${
        this.loadFailed
          ? html`<p class="notice" role="alert">${t("schedule.load_failed")}</p>`
          : nothing
      }
      ${this.#shiftsSection()} ${this.#swapsSection()} ${this.#coverSection()}
      ${this.#absencesSection()} ${this.#absenceForm()}
    `;
  }

  #shiftsSection() {
    const shifts = this.shifts;
    return html`<section class="shifts">
      <h2>${t("schedule.shifts_title")}</h2>
      ${
        shifts === undefined
          ? nothing
          : shifts.length === 0
            ? html`<p class="status">${t("schedule.shifts_empty")}</p>`
            : html`<ul>
                ${shifts.map(
                  (shift) =>
                    html`<li class="shift" data-shift=${shift.id}>
                      <span>${this.#shiftLabel(shift)}</span>
                    </li>`,
                )}
              </ul>`
      }
    </section>`;
  }

  #swapsSection() {
    const offered = this.swaps?.filter(
      (s) => s.direction === "offered_to_me" && s.status === "requested",
    );
    return html`<section class="swaps">
      <h2>${t("schedule.swaps_title")}</h2>
      ${
        offered === undefined
          ? nothing
          : offered.length === 0
            ? html`<p class="status">${t("schedule.swaps_empty")}</p>`
            : html`<ul>
                ${offered.map(
                  (swap) =>
                    html`<li class="swap" data-swap=${swap.id}>
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
              </ul>`
      }
    </section>`;
  }

  #coverSection() {
    const shifts = this.shifts ?? [];
    const colleagues = this.#colleagues();
    return html`<section class="cover">
      <h2>${t("schedule.cover_title")}</h2>
      <div class="form">
        ${this.#dropdown(
          "cover-shift",
          t("schedule.cover_shift"),
          [NONE, ...shifts.map((shift) => ({ value: shift.id, label: this.#shiftLabel(shift) }))],
          this.coverShiftId,
          (value) => (this.coverShiftId = value),
        )}
        ${this.#dropdown(
          "cover-colleague",
          t("schedule.cover_colleague"),
          [
            NONE,
            ...colleagues.map((person) => ({
              value: person.personId,
              label: person.displayName,
            })),
          ],
          this.coverColleagueId,
          (value) => (this.coverColleagueId = value),
        )}
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

  /** This schedule keeps its empty NONE row as a hint, so its label also supplies the placeholder. */
  #dropdown(
    name: string,
    label: string,
    options: ComboboxOption[],
    value: string,
    onPick: (value: string) => void,
  ) {
    return html`<wt-combobox
      name=${name}
      label=${label}
      search="auto"
      searchPlaceholder=${t("form.combobox_search")}
      noResultsLabel=${t("form.combobox_no_results")}
      placeholder=${options[0] === NONE ? NONE.label : ""}
      .options=${options}
      .value=${value}
      @wt-change=${(e: CustomEvent<{ value: string }>) => {
        e.stopPropagation();
        onPick(e.detail.value);
      }}
    ></wt-combobox>`;
  }

  #absencesSection() {
    const absences = this.absences;
    return html`<section class="absences">
      <h2>${t("schedule.absences_title")}</h2>
      ${
        absences === undefined
          ? nothing
          : absences.length === 0
            ? html`<p class="status">${t("schedule.absences_empty")}</p>`
            : html`<ul>
                ${absences.map(
                  (absence) =>
                    html`<li class="absence" data-absence=${absence.id}>
                      <span
                        >${t(`schedule.kind.${absence.kind}`)} · ${absence.startsOn} –
                        ${absence.endsOn}</span
                      >
                      <span class="meta">${t(`schedule.status.${absence.status}`)}</span>
                    </li>`,
                )}
              </ul>`
      }
    </section>`;
  }

  #absenceForm() {
    return html`<section class="request-absence">
      <h2>${t("schedule.absence_title")}</h2>
      <div class="form">
        ${this.#dropdown(
          "abs-kind",
          t("schedule.absence_kind"),
          ABSENCE_KINDS.map((kind) => ({ value: kind, label: t(`schedule.kind.${kind}`) })),
          this.absKind,
          (value) => (this.absKind = value as AbsenceKind),
        )}
        <wt-input
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(".abs-submit"))}
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
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(".abs-submit"))}
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
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(".abs-submit"))}
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
