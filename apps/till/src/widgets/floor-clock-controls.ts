import { css, html, nothing } from "lit";
import type { TillClockState } from "../api/attendance-api.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { TillClockAction } from "../state/clocking.js";
import { attendanceDuration, storedAttendanceTime, withHourArticle } from "./attendance-history.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-initials.js";

export const floorClockStyles = css`
  .floor-operator {
    display: flex;
    align-items: center;
    gap: var(--wt-space-2);
    padding: var(--wt-space-2) var(--wt-menu-row-padding-start);
  }

  .floor-operator-name {
    font-size: var(--wt-floor-name-font-size);
    font-weight: var(--wt-font-weight-bold);
    overflow-wrap: anywhere;
  }

  .floor-operator-state {
    display: flex;
    align-items: center;
    gap: var(--wt-space-2);
    color: var(--wt-color-text-muted);
    font-size: calc((var(--wt-font-size-sm) + var(--wt-font-size-md)) / 2);
  }

  .floor-operator-state .clock-dot {
    display: inline-block;
    flex: none;
  }

  .floor-clock-actions {
    --wt-action-text-align: center;
    --wt-action-border: initial;
    --wt-action-border-color: initial;
    --wt-action-radius: initial;
    --wt-action-background: initial;
    --wt-action-text: initial;
    --wt-action-weight: initial;
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: var(--wt-space-2);
    padding: 0 var(--wt-menu-row-padding-start) var(--wt-space-2);
  }

  .floor-clock-actions wt-button::part(button) {
    justify-content: center;
    min-block-size: calc(var(--wt-tap-min) + var(--wt-space-1) / 2);
  }

  [data-floor-break] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wt-space-2);
    margin: 0 var(--wt-space-3) var(--wt-space-2);
    padding-inline: var(--wt-space-3);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-tab-warning-tint);
    color: var(--wt-color-text);
    font-weight: var(--wt-font-weight-bold);
  }

  [data-floor-break] wt-button::part(button) {
    text-decoration: underline;
  }

  .floor-menu [data-break-dot] {
    position: absolute;
    inset-block-start: calc(-1 * var(--wt-space-1));
    inset-inline-end: calc(-1 * var(--wt-space-1));
    inline-size: calc(var(--wt-space-2) + var(--wt-space-1) / 2);
    block-size: calc(var(--wt-space-2) + var(--wt-space-1) / 2);
    padding: 0;
    border-radius: var(--wt-radius-full);
    box-shadow: 0 0 0 calc(var(--wt-space-1) / 2) var(--wt-color-surface);
    background: var(--wt-color-warning);
    pointer-events: none;
  }

  .floor-menu [data-break-dot][data-has-count] {
    inset-inline-start: calc(-1 * var(--wt-space-1));
    inset-inline-end: auto;
  }
`;

function elapsed(now: number, start: string): string {
  return attendanceDuration(Math.max(0, Math.floor((now - Date.parse(start)) / 60_000)), true);
}

export function floorOperatorLine(
  name: string,
  state: TillClockState | null | undefined,
  now: number,
) {
  const status = state?.state ?? "unknown";
  const working = state?.state === "working";
  const start = name ? (working ? state.shiftStart : state?.breakStart) : null;
  return html`<div class="floor-operator">
    <wt-initials .name=${name} .locale=${currentLocale()}></wt-initials>
    <div>
      <div class="floor-operator-name">${name}</div>
      ${
        state === undefined
          ? nothing
          : html`<div class="floor-operator-state" data-clock-state>
              ${status === "out" ? nothing : html`<span class=${`clock-dot ${status}`} aria-hidden="true"></span>`}
              ${
                start
                  ? html`<span
                      >${
                        working
                          ? html`<time datetime=${start.eventAt}
                              >${fill(
                                withHourArticle(
                                  "clock.working_since",
                                  start.eventAt,
                                  start.offsetMinutes,
                                ),
                                {
                                  time: storedAttendanceTime(
                                    start.eventAt,
                                    start.offsetMinutes,
                                  ).slice(11, 16),
                                },
                              )}</time
                            >`
                          : t("clock.on_break")
                      }
                      · ${elapsed(now, start.eventAt)}</span
                    >`
                  : t(
                      (
                        {
                          working: "clock.working",
                          on_break: "clock.on_break",
                          out: "clock.clocked_out",
                          unknown: "clock.unknown",
                        } as const
                      )[status],
                    )
              }
            </div>`
      }
    </div>
  </div>`;
}

export function floorShiftActions(
  state: "working" | "on_break",
  disabled: boolean,
  press: (action: TillClockAction) => void,
) {
  const action = (kind: TillClockAction, label: string) =>
    html`<wt-button
      data-clock-action=${kind}
      variant=${kind === "break-end" && !disabled ? "primary" : "secondary"}
      .disabled=${disabled}
      @click=${() => press(kind)}
      >${label}</wt-button
    >`;
  return html`<div class="floor-clock-actions">
    ${
      state === "on_break"
        ? action("break-end", t("clock.break_end"))
        : html`${action("break-start", t("clock.break_start"))}${action("out", t("clock.out"))}`
    }
  </div>`;
}

export function floorBreakStrip(
  state: TillClockState | null,
  now: number,
  busy: boolean,
  end: () => void,
) {
  if (state?.state !== "on_break") return nothing;
  return html`<div data-floor-break>
    <span
      >${t("clock.on_break")}${state.breakStart ? ` · ${elapsed(now, state.breakStart.eventAt)}` : ""}</span
    >
    <wt-button variant="ghost" .disabled=${busy} @click=${end}>${t("clock.break_end")}</wt-button>
  </div>`;
}
