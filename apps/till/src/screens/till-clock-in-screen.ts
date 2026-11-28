import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { TickingClock, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-foot-button-bar.js";
import "@waitron/ui/src/components/wt-initials.js";
import type { MyShift, TillClockState } from "../api/attendance-api.js";
import type { TillApi } from "../api/client.js";
import { clockTime, currentLocale, fill, t } from "../i18n/t.js";
import type { SignInClockAction } from "../state/clock-sign-in.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { storedAttendanceTime, withHourArticle } from "../widgets/attendance-history.js";
import { localIsoDate, scheduleWindow } from "./till-schedule-screen.js";

function shiftFor(shifts: readonly MyShift[], now: number): MyShift | undefined {
  const today = localIsoDate(new Date(now));
  return (
    shifts.find((shift) => Date.parse(shift.startsAt) <= now && now < Date.parse(shift.endsAt)) ??
    shifts.find(
      (shift) =>
        now < Date.parse(shift.startsAt) &&
        storedAttendanceTime(shift.startsAt, shift.startsOffsetMinutes).slice(0, 10) === today,
    )
  );
}

@customElement("till-clock-in-screen")
export class TillClockInScreen extends LitElement {
  readonly #clock = new TickingClock(this);
  #shiftRequested = false;
  @state() private shifts: readonly MyShift[] = [];

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-block-size: 0;
      }
      main {
        flex: 1;
        display: grid;
        align-content: safe center;
        justify-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-5);
        overflow: auto;
        text-align: center;
        overflow-wrap: break-word;
      }
      h1,
      p {
        margin: 0;
      }
      h1 {
        margin-block-start: var(--wt-space-3);
        font-size: calc(var(--wt-font-size-xl) + var(--wt-space-1));
        text-wrap: balance;
      }
      .subheading {
        color: var(--wt-color-text-muted);
      }
      .details {
        inline-size: min(100%, var(--wt-form-max-width));
        padding: var(--wt-space-3) var(--wt-space-4);
        margin-block-start: var(--wt-space-4);
        background: var(--wt-color-surface-lifted);
        border-radius: calc(var(--wt-radius-md) + var(--wt-space-1) / 2);
        text-align: start;
      }
      .details strong {
        font-size: var(--wt-font-size-lg);
        font-variant-numeric: tabular-nums;
      }
      wt-foot-button-bar {
        inline-size: min(100%, var(--wt-form-max-width));
        margin-inline: auto;
      }
      wt-foot-button-bar > wt-button:not([slot]) {
        --wt-action-font-size: var(--wt-menu-row-label-size);
      }
      [slot="link"] {
        --wt-action-font-size: calc(var(--wt-font-size-md) + var(--wt-space-1) / 4);
      }
    `,
  ];

  @property({ attribute: false }) api?: Pick<TillApi, "listMyShifts">;
  @property() action: SignInClockAction = "in";
  @property() displayName = "";
  @property({ attribute: false }) breakStart: TillClockState["breakStart"] = null;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) reading = false;
  @property({ type: Boolean }) canAct = true;
  @property() error = "";

  protected override updated(): void {
    const api = this.api;
    if (!api || this.#shiftRequested || this.reading || !this.canAct || this.action !== "in")
      return;
    this.#shiftRequested = true;
    void this.#readShifts(api);
  }

  async #readShifts(api: Pick<TillApi, "listMyShifts">): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const { from, to } = scheduleWindow(yesterday, 2);
    try {
      const shifts = await api.listMyShifts(from, to);
      if (this.isConnected && this.api === api)
        this.shifts = [...shifts].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    } catch {
      // The roster is optional here, so its refusal leaves Clock in available.
    }
  }

  #emit(type: string, detail: unknown = null): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #details() {
    if (this.action === "break-end") {
      const start = this.breakStart;
      if (!start) return nothing;
      const elapsed = Math.max(
        0,
        Math.floor((this.#clock.now - Date.parse(start.eventAt)) / 60_000),
      );
      const duration = fill(t("clock.elapsed_minutes"), {
        n: new Intl.NumberFormat(currentLocale()).format(elapsed),
      });
      return html`<div class="details">
        <p>${withHourArticle("clock.break_since", start.eventAt, start.offsetMinutes)}</p>
        <strong
          ><time datetime=${start.eventAt}
            >${storedAttendanceTime(start.eventAt, start.offsetMinutes).slice(11, 16)}</time
          >
          · ${duration}</strong
        >
      </div>`;
    }
    const shift = shiftFor(this.shifts, this.#clock.now);
    if (!shift) return nothing;
    const start = storedAttendanceTime(shift.startsAt, shift.startsOffsetMinutes).slice(11, 16);
    const end = storedAttendanceTime(shift.endsAt, shift.endsOffsetMinutes).slice(11, 16);
    const label = `${start} – ${end}${shift.description ? ` · ${shift.description}` : ""}`;
    return html`<div class="details" data-rota>
      <p>${t("clock.shift_today")}</p>
      <strong>${label}</strong>
    </div>`;
  }

  override render() {
    const ready = !this.reading && this.canAct;
    const endingBreak = this.action === "break-end";
    const action = t(endingBreak ? "clock.break_end" : "clock.in");
    const name = this.displayName.trim().split(/\s+/u, 1)[0] ?? "";
    return html`
      <main>
        <wt-initials size="lg" .name=${this.displayName} .locale=${currentLocale()}></wt-initials>
        <h1>
          ${name ? fill(t(endingBreak ? "clock.welcome_back" : "clock.hello"), { name }) : action}
        </h1>
        ${
          ready && !this.error
            ? html`<p class="subheading">
                ${t(endingBreak ? "clock.on_break_intro" : "clock.not_clocked_in")}
              </p>`
            : nothing
        }
        ${this.#details()}
        ${this.error ? html`<p role="status">${this.error}</p>` : this.reading ? html`<p role="status">${t("clock.reading")}</p>` : nothing}
      </main>
      <wt-foot-button-bar>
        <wt-button
          ?data-clock-in=${!endingBreak}
          ?data-end-break=${endingBreak}
          variant=${ready || this.busy ? "primary" : "secondary"}
          .loading=${this.busy}
          .disabled=${!ready || this.busy}
          @click=${() => (endingBreak ? this.#emit("clock-action", { action: "break-end" }) : this.#emit("clock-in"))}
          >${action} · ${clockTime(this.#clock.now)}</wt-button
        >
        ${this.error ? html`<wt-button data-retry variant="secondary" .disabled=${this.busy || this.reading} @click=${() => this.#emit("retry-clock-read")}>${t("clock.retry")}</wt-button>` : nothing}
        <wt-button
          data-cancel
          slot="link"
          variant="ghost"
          .disabled=${this.busy}
          @click=${() => this.#emit("cancel-clock-in")}
          >${t("clock.not_now")}</wt-button
        >
      </wt-foot-button-bar>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-clock-in-screen": TillClockInScreen;
  }
}
