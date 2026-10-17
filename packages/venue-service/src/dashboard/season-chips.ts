import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { format, formatMonthDay } from "./hours-view.js";
import { byStart, type Season } from "../season-rules.js";
import { seasonTints, seasonTintStyles } from "./season-tint.js";
import { t } from "./strings.js";

export type SeasonChip = Season & { lastDay: string };

/** The venue's seasons as tinted chips. A chip's name asks for its week (`season-week-open`), also
 *  when read-only, but not as a key only. */
@customElement("season-chips")
export class SeasonChips extends LitElement {
  static override styles = [
    baseStyles,
    seasonTintStyles,
    css`
      :host {
        display: block;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .label {
        color: var(--wt-color-text-muted);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1) var(--wt-space-3);
        border: 1px solid;
        border-radius: var(--wt-radius-full);
        font: inherit;
      }
      .chip button {
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .chip button:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      .chip[data-tint] {
        background: var(--season-tint);
        color: var(--season-on-tint);
        border-color: var(--season-tint-line);
      }
    `,
  ];
  /** Each season with its last day as the server reads it, so 29 February in a leap year. */
  @property({ attribute: false }) seasons: readonly SeasonChip[] = [];
  @property({ type: Boolean }) readOnly = false;
  /** Draws the chips as a key to the tints alone, with no week to ask for. */
  @property({ type: Boolean }) keyOnly = false;

  private openWeek(season: SeasonChip) {
    this.dispatchEvent(
      new CustomEvent<{ seasonId: string }>("season-week-open", {
        detail: { seasonId: season.id },
        bubbles: true,
        composed: true,
      }),
    );
  }
  override render() {
    const tints = seasonTints(this.seasons);
    return html`<div class="row">
      <span class="label">${t("season.seasons")}</span>
      ${byStart(this.seasons).map((season) => {
        const range = {
          from: formatMonthDay(season.startsOn),
          to: formatMonthDay(season.lastDay),
        };
        const label = format("season.chip", { name: season.name, ...range });
        const tint = tints.get(season.id);
        if (this.keyOnly)
          return html`<span class="chip" data-season=${season.id} data-tint=${tint}
            >${label}</span
          >`;
        const week = html`<button
          type="button"
          data-test="season-week"
          aria-label=${format(this.readOnly ? "season.week_shown" : "season.week_named", {
            name: season.name,
            ...range,
          })}
          @click=${() => this.openWeek(season)}
        >
          ${label}
        </button>`;
        return html`<span class="chip" data-season=${season.id} data-tint=${tint}>${week}</span>`;
      })}
      <slot></slot>
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "season-chips": SeasonChips;
  }
}
