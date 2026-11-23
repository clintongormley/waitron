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

/** One notice line's look, for the strip and the PIN screen. */
export const noticeLineStyles = css`
  .line {
    display: flex;
    align-items: center;
    gap: var(--wt-space-2);
    margin: 0;
    padding: var(--wt-space-2) var(--wt-space-3);
    border-inline-start: var(--wt-space-1) solid;
    color: var(--wt-color-text);
    background: var(--wt-color-surface-raised);
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

  .line wt-icon {
    flex: none;
  }

  /* An action that does not fit after the whole sentence wraps below it, beside the icon. */
  .line .body {
    flex: 1 1 auto;
    min-inline-size: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
  }

  .line .words {
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }

  .line .main {
    font-weight: var(--wt-font-weight-bold);
  }

  .line .hint {
    color: var(--wt-color-text-muted);
  }
`;

interface LineParts {
  /** In place of the hint. */
  action?: TemplateResult | undefined;
  /** Drop the hint. */
  hint?: boolean;
  /** At the line's trailing end, after the words and any action. */
  trailing?: TemplateResult;
}

/** The icon, then the words and any action wrapping together beside it. */
function lineBody(
  notice: StaffNotice,
  { action, hint = true, trailing }: LineParts,
): TemplateResult {
  const words = staffNoticeText(notice);
  return html`<wt-icon name=${`staff-notice-${toneOf(notice.severity)}`}></wt-icon
    ><span class="body"
      ><span class="words"
        ><strong class="main">${words.main}</strong>${
          hint && action === undefined && words.hint !== ""
            ? html` · <span class="hint">${words.hint}</span>`
            : nothing
        }</span
      >${action ?? nothing}</span
    >${trailing === undefined ? nothing : html` ${trailing}`}`;
}

/** One notice as a line in its tone, drawn by {@link noticeLineStyles}. */
export function noticeLine(
  notice: StaffNotice,
  parts: LineParts & { listItem?: boolean } = {},
): TemplateResult {
  const tone = toneOf(notice.severity);
  return parts.listItem
    ? html`<li class="line" data-notice-tone=${tone}>${lineBody(notice, parts)}</li>`
    : html`<p class="line" data-notice-tone=${tone}>${lineBody(notice, parts)}</p>`;
}

function hasAction(notice: StaffNotice, checkTime: boolean, host: TillNoticeStrip): boolean {
  return (
    checksTime(notice, checkTime) ||
    (notice.code === "print_job.drawer_expired" && host.canOpenDrawer)
  );
}

function action(notice: StaffNotice, checkTime: boolean, host: TillNoticeStrip): TemplateResult {
  return checksTime(notice, checkTime)
    ? html`<wt-button
        data-check-time
        variant="secondary"
        @click=${() =>
          host.dispatchEvent(new CustomEvent("till-check-time", { bubbles: true, composed: true }))}
        >${staffNoticeText(notice, checkTime).hint}</wt-button
      >`
    : html`<wt-button
        data-open-drawer
        variant="secondary"
        .disabled=${host.drawerBusy}
        @click=${() =>
          host.dispatchEvent(
            new CustomEvent("till-open-drawer", { bubbles: true, composed: true }),
          )}
        >${t("action.open_drawer")}</wt-button
      >`;
}

@customElement("till-notice-strip")
export class TillNoticeStrip extends LitElement {
  static override styles = [
    baseStyles,
    noticeLineStyles,
    css`
      :host {
        display: block;
      }

      .strip {
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border-block-end: 1px solid var(--wt-color-border);
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
  @property({ attribute: false }) canOpenDrawer = false;
  @property({ attribute: false }) drawerBusy = false;
  /** No action. A clock line whose check the box offers drops its hint, as on the PIN screen:
   * "See Box status" would send the person elsewhere for a step that is their own. */
  @property({ attribute: false }) wordsOnly = false;

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

  #parts(notice: StaffNotice): LineParts {
    const checkTime = this.checkTimeOffered;
    if (this.wordsOnly) return { hint: !checksTime(notice, checkTime) };
    return {
      action: hasAction(notice, checkTime, this) ? action(notice, checkTime, this) : undefined,
    };
  }

  #line(notice: StaffNotice, parts: { listItem?: boolean; trailing?: TemplateResult } = {}) {
    return noticeLine(notice, { ...parts, ...this.#parts(notice) });
  }

  #strip(first: StaffNotice): TemplateResult {
    if (this.notices.length === 1) {
      return html`<div class="strip" data-notice-strip>${this.#line(first)}</div>`;
    }
    const more = this.notices.length - 1;
    const [shown, spoken] = this.open
      ? [t("staff_notice.hide"), t("staff_notice.hide_label")]
      : [
          t("staff_notice.more").replace("{n}", String(more)),
          countText(more, "staff_notice.more_label", "staff_notice.more_label_one"),
        ];
    const moreWords = html`<span class="more" data-notice-more
      ><span aria-hidden="true">${shown}</span><span class="visually-hidden">${spoken}</span></span
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
    const parts = this.#parts(first);
    // An action and the notice-list toggle are siblings, so a button never holds another button.
    return html`<div class="strip" data-notice-strip>
      ${
        parts.action === undefined
          ? toggle("line", lineBody(first, { ...parts, trailing: moreWords }))
          : this.#line(first, { trailing: toggle("toggle", moreWords) })
      }
      ${
        this.open
          ? html`<ul
              id="notice-list"
              data-notice-list
              tabindex="0"
              aria-label=${t("staff_notice.list")}
            >
              ${this.notices.slice(1).map((notice) => this.#line(notice, { listItem: true }))}
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
