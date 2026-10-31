import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, registerIcons, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-icon.js";
import type { StaffNotice } from "../api/client.js";
import "@waitron/ui/src/components/wt-button.js";
import { checksTime, staffNoticeText } from "../i18n/staff-notices.js";
import { countText, t } from "../i18n/t.js";

const TONES = ["error", "warning", "notice"] as const;
type Tone = (typeof TONES)[number];

registerIcons({
  "staff-notice-error": "M8 1a7 7 0 1 0 0 14A7 7 0 1 0 8 1ZM7 4h2v5H7ZM7 10h2v2H7Z",
  "staff-notice-warning": "M8 1 15 14H1ZM7 5v5h2V5ZM7 11v2h2v-2Z",
  "staff-notice-notice": "M8 1a7 7 0 1 0 0 14A7 7 0 1 0 8 1ZM7 4h2v2H7ZM7 7h2v5H7Z",
});

/** A severity a newer server sends that this till does not know is drawn in the notice tone. */
function toneOf(severity: string): Tone {
  return (TONES as readonly string[]).includes(severity) ? (severity as Tone) : "notice";
}

/** A notice's icon and words; a clock stop's hint is a "Check the time" button while `checkTime`. */
function words(notice: StaffNotice, checkTime: boolean, host: HTMLElement): TemplateResult {
  const { main, hint } = staffNoticeText(notice, checkTime);
  return html`<wt-icon name=${`staff-notice-${toneOf(notice.severity)}`}></wt-icon
    ><span class="words"
      ><strong class="main">${main}</strong>${
        checksTime(notice, checkTime)
          ? html` <wt-button
              data-check-time
              variant="secondary"
              @click=${() =>
                host.dispatchEvent(
                  new CustomEvent("till-check-time", { bubbles: true, composed: true }),
                )}
              >${hint}</wt-button
            >`
          : html` · <span class="hint">${hint}</span>`
      }</span
    >`;
}

/** The till's staff notices under its top bar: the first notice, and with more a tap that opens
 * the rest in the page's flow. Never a dialog and never dismissed; its one event is
 * `till-check-time`, from a clock stop's "Check the time" while `checkTimeOffered`. */
@customElement("till-notice-strip")
export class TillNoticeStrip extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .strip {
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border-block-end: 1px solid var(--wt-color-border);
      }

      .line {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-inline-start: var(--wt-space-1) solid;
        color: var(--wt-color-text);
      }

      .line[data-notice-tone="error"] {
        border-inline-start-color: var(--wt-color-danger);
      }
      .line[data-notice-tone="error"] wt-icon {
        color: var(--wt-color-danger);
      }
      .line[data-notice-tone="warning"] {
        border-inline-start-color: var(--wt-color-warning);
      }
      .line[data-notice-tone="warning"] wt-icon {
        color: var(--wt-color-warning);
      }
      .line[data-notice-tone="notice"] {
        border-inline-start-color: var(--wt-color-primary);
      }
      .line[data-notice-tone="notice"] wt-icon {
        color: var(--wt-color-primary);
      }

      wt-icon {
        flex: none;
      }

      .words {
        flex: 1 1 auto;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }

      .main {
        font-weight: var(--wt-font-weight-bold);
      }

      .hint {
        color: var(--wt-color-text-muted);
      }

      button.line {
        inline-size: 100%;
        min-block-size: var(--wt-tap-min);
        font: inherit;
        text-align: start;
        background: none;
        border-block: 0;
        border-inline-end: 0;
        cursor: pointer;
      }

      /* The strip spans the screen, so a ring drawn outside it would lose its sides. */
      button.line:focus-visible,
      button.toggle:focus-visible,
      ul:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }

      button.toggle {
        flex: none;
        min-block-size: var(--wt-tap-min);
        min-inline-size: var(--wt-tap-min);
        font: inherit;
        color: inherit;
        background: none;
        border: 0;
        cursor: pointer;
      }

      .more {
        flex: none;
        font-weight: var(--wt-font-weight-bold);
      }

      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        max-block-size: 50vh;
        overflow-y: auto;
        border-block-start: 1px solid var(--wt-color-border);
      }

      .visually-hidden {
        ${visuallyHiddenStyles}
      }
    `,
  ];

  @property({ attribute: false }) notices: readonly StaffNotice[] = [];
  /** The box offers this till "Check the time". */
  @property({ attribute: false }) checkTimeOffered = false;

  @state() private open = false;

  override willUpdate(): void {
    if (this.notices.length < 2) this.open = false;
  }

  override render(): TemplateResult {
    const [first] = this.notices;
    return html`${first === undefined ? nothing : this.#strip(first)}
      <div class="visually-hidden" role="status" data-notice-announce>
        ${first === undefined ? "" : staffNoticeText(first).main}
      </div>`;
  }

  #strip(first: StaffNotice): TemplateResult {
    const checkTime = this.checkTimeOffered;
    if (this.notices.length === 1) {
      return html`<div class="strip" data-notice-strip>
        <p class="line" data-notice-tone=${toneOf(first.severity)}>
          ${words(first, checkTime, this)}
        </p>
      </div>`;
    }
    const more = this.notices.length - 1;
    const moreWords = html`<span class="more" data-notice-more
      ><span aria-hidden="true">${t("staff_notice.more").replace("{n}", String(more))}</span
      ><span class="visually-hidden"
        >${countText(more, "staff_notice.more_label", "staff_notice.more_label_one")}</span
      ></span
    >`;
    const toggle = (cls: string, content: TemplateResult) =>
      html`<button
        type="button"
        class=${cls}
        data-notice-tone=${toneOf(first.severity)}
        aria-expanded=${this.open ? "true" : "false"}
        aria-controls="notice-list"
        @click=${() => (this.open = !this.open)}
      >
        ${content}
      </button>`;
    // A button never holds another, so the "Check the time" line keeps its toggle beside it.
    return html`<div class="strip" data-notice-strip>
      ${
        checksTime(first, checkTime)
          ? html`<div class="line" data-notice-tone=${toneOf(first.severity)}>
              ${words(first, checkTime, this)} ${toggle("toggle", moreWords)}
            </div>`
          : toggle("line", html`${words(first, checkTime, this)} ${moreWords}`)
      }
      ${
        this.open
          ? html`<ul
              id="notice-list"
              data-notice-list
              tabindex="0"
              aria-label=${t("staff_notice.list")}
            >
              ${this.notices.map(
                (notice) =>
                  html`<li class="line" data-notice-tone=${toneOf(notice.severity)}>
                    ${words(notice, checkTime, this)}
                  </li>`,
              )}
            </ul>`
          : nothing
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-notice-strip": TillNoticeStrip;
  }
}
