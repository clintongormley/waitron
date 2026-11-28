import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { TickingClock, baseStyles } from "@waitron/ui";
import { localCalendarDate, timeZoneOffsetMinutes } from "@waitron/shared";
import type { AttendanceDayView } from "@waitron/workforce/attendance-contract";
import type { AttendanceApi, TillClockState } from "../api/attendance-api.js";
import { t } from "../i18n/t.js";
import { clockOutDate, clockOutPreview } from "../state/clock-out-preview.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import {
  attendanceDateInWords,
  attendanceDuration,
  storedAttendanceTime,
} from "./attendance-history.js";
import { trackDialog } from "./track-dialog.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-foot-button-bar.js";
import "@waitron/ui/src/components/wt-full-screen-panel.js";

@customElement("till-clock-out-sheet")
export class TillClockOutSheet extends LitElement {
  static override styles = [
    baseStyles,
    css`
      wt-dialog {
        --wt-dialog-surface: transparent;
      }
      wt-dialog::part(body) {
        display: grid;
        grid-template-rows: minmax(0, 1fr);
        place-items: end center;
      }
      wt-full-screen-panel {
        inline-size: 100%;
        block-size: auto;
        max-block-size: 100%;
        background: var(--wt-color-surface);
      }
      wt-foot-button-bar::part(footer) {
        border-block-start: 0;
      }
      [data-confirm-clock-out] {
        --wt-action-font-size: calc((var(--wt-font-size-md) + var(--wt-font-size-lg)) / 2);
      }
      @media (min-width: 800px) {
        wt-full-screen-panel {
          max-inline-size: var(--wt-dialog-max-width);
        }
      }
      section {
        padding: var(--wt-space-3) var(--wt-space-4) var(--wt-space-4);
      }
      h2 {
        font-size: var(--wt-font-size-xl);
        margin: 0;
      }
      p {
        color: var(--wt-color-text-muted);
        margin: var(--wt-space-2) 0 var(--wt-space-3);
      }
      dl {
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        margin: 0;
      }
      dl > div {
        display: flex;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
      }
      dl > div + div {
        border-block-start: var(--wt-field-line-width) solid var(--wt-color-border);
      }
      dd {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
        text-align: end;
      }
    `,
  ];

  @property({ attribute: false }) api!: Pick<AttendanceApi, "getAttendanceDay">;
  @property({ attribute: false }) clockState!: TillClockState;
  @state() private day: AttendanceDayView | null = null;
  @state() private reading = false;
  readonly #clock = new TickingClock(this);
  #read?: AbortController;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override async firstUpdated(): Promise<void> {
    const dialog = this.renderRoot.querySelector("wt-dialog")!;
    const stay =
      this.renderRoot.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-stay-clocked-in]")!;
    await Promise.all([dialog.updateComplete, stay.updateComplete]);
    if (this.isConnected && dialog.open) stay.focus();
  }

  override disconnectedCallback(): void {
    this.#read?.abort();
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    const previous = changed.get("clockState");
    const current = this.clockState;
    if (
      changed.has("api") ||
      (changed.has("clockState") &&
        (previous?.personId !== current.personId ||
          previous.lastEntryId !== current.lastEntryId ||
          clockOutDate(previous) !== clockOutDate(current)))
    )
      void this.#readDay();
  }

  async #readDay(): Promise<void> {
    this.#read?.abort();
    this.day = null;
    const date = clockOutDate(this.clockState);
    this.reading = date !== null;
    if (date === null) return;
    const personId = this.clockState.personId;
    const request = new AbortController();
    this.#read = request;
    try {
      const value = await this.api.getAttendanceDay(date, { signal: request.signal });
      if (!request.signal.aborted && value.personId === personId && value.date === date)
        this.day = value;
    } catch {
      // The clock write is independent of the day read.
    } finally {
      if (!request.signal.aborted) this.reading = false;
    }
  }

  override render() {
    const title = t("clock.out_title");
    const day = this.day;
    const now = new Date(this.#clock.now);
    const offset = day ? timeZoneOffsetMinutes(day.timeZone, now) : null;
    const time =
      offset === null ? "" : storedAttendanceTime(now.toISOString(), offset).slice(11, 16);
    const date =
      day && offset !== null
        ? localCalendarDate(now, offset) === day.date
          ? t("clock.out_today")
          : attendanceDateInWords(day.date)
        : "";
    const sessions = day ? clockOutPreview(day, this.clockState, now) : null;
    return html`<wt-dialog
      ${trackDialog()}
      open
      full-screen
      aria-label=${title}
      @wt-close=${() => this.dispatchEvent(new Event("clock-out-dismiss"))}
    >
      <wt-full-screen-panel rising body-label=${title}>
        <section>
          <h2>${title}</h2>
          ${
            sessions === null
              ? html`<p role="status">
                  ${t(this.reading ? "clock.reading" : "clock.out_unavailable")}
                </p>`
              : html`<p>${t("clock.out_summary")}</p>
                  <dl>
                    <div>
                      <dt>${date}</dt>
                      <dd>
                        ${sessions.map(
                          (session) =>
                            html`<div>
                              ${storedAttendanceTime(
                                session.startedAt,
                                session.startOffsetMinutes,
                              ).slice(11, 16)}
                              –
                              ${storedAttendanceTime(session.endedAt, session.endOffsetMinutes).slice(11, 16)}
                            </div>`,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>${t("hours.breaks")}</dt>
                      <dd>
                        ${attendanceDuration(
                          sessions.reduce((sum, session) => sum + session.breakMinutes, 0),
                          true,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>${t("clock.out_worked")}</dt>
                      <dd>
                        ${attendanceDuration(
                          sessions.reduce((sum, session) => sum + session.workedMinutes, 0),
                          true,
                        )}
                      </dd>
                    </div>
                  </dl>`
          }
        </section>
        <wt-foot-button-bar slot="footer">
          <wt-button
            data-confirm-clock-out
            variant="primary"
            @click=${() => this.dispatchEvent(new Event("clock-out-confirm"))}
            >${t("clock.out")}${time ? ` · ${time}` : ""}</wt-button
          >
          <wt-button
            slot="link"
            variant="ghost"
            data-stay-clocked-in
            @click=${() => void this.renderRoot.querySelector("wt-dialog")!.requestClose("cancel")}
            >${t("clock.stay_in")}</wt-button
          >
        </wt-foot-button-bar>
      </wt-full-screen-panel>
    </wt-dialog>`;
  }
}

export function renderClockOutSheet(
  api: Pick<AttendanceApi, "getAttendanceDay">,
  state: TillClockState | null,
  close: (confirmed: boolean) => void,
) {
  if (state === null || state.state === "out") return nothing;
  return html`<till-clock-out-sheet
    .api=${api}
    .clockState=${state}
    @clock-out-dismiss=${() => close(false)}
    @clock-out-confirm=${() => close(true)}
  ></till-clock-out-sheet>`;
}

declare global {
  interface HTMLElementTagNameMap {
    "till-clock-out-sheet": TillClockOutSheet;
  }
}
