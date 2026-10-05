import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { uniqueId } from "../interactive.js";

const UNITS = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
] as const satisfies readonly (readonly [Intl.RelativeTimeFormatUnit, number])[];

interface Reading {
  words: string;
  exact: string;
  /** Milliseconds until `words` would read differently; null when they never will. */
  changesIn: number | null;
}

/**
 * Whole units, rounded towards zero, so a deadline never reads later than it is and a report never
 * newer than it is.
 */
function read(
  at: number,
  now: number,
  onlyAhead: boolean,
): { value: number; unit: Intl.RelativeTimeFormatUnit; changesIn: number | null } {
  const ahead = at - now;
  if (onlyAhead && ahead <= 0) return { value: 0, unit: "second", changesIn: null };
  const distance = Math.abs(ahead);
  const [unit, size] = UNITS.find(([, size]) => distance >= size) ?? UNITS[3];
  const count = Math.floor(distance / size);
  // Ahead, the count drops just after the distance passes a whole unit; behind, it rises on one.
  const changesIn = ahead > 0 ? distance - count * size || 1 : (count + 1) * size - distance;
  return { value: ahead > 0 ? count : -count || 0, unit, changesIn };
}

@customElement("wt-relative-time")
export class WtRelativeTime extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline;
        color: inherit;
        font: inherit;
      }

      button {
        display: inline;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: inherit;
        text-decoration: underline dotted;
        text-decoration-thickness: 1px;
        cursor: help;
      }

      /* Fixed, because place() writes viewport coordinates onto it. */
      [popover] {
        position: fixed;
        margin: 0;
        max-width: var(--wt-dialog-max-width);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }
    `,
  ];

  /** The moment, as an ISO-8601 instant. One that does not parse draws nothing. */
  @property() datetime = "";
  /** A BCP 47 language tag; empty is the browser's own. */
  @property() locale = "";
  /** An IANA zone for the exact time; empty is the browser's own. */
  @property({ attribute: "time-zone" }) timeZone = "";
  /** For a deadline: a moment already gone reads "now" rather than how long ago it was. */
  @property({ type: Boolean }) future = false;
  /** Replaced by a test, or by a screen whose own clock is replaced. */
  @property({ attribute: false }) now = (): Date => new Date();

  @state() private open = false;
  /** Opened by a tap or click rather than a passing mouse, so the mouse leaving keeps it. */
  #pinned = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #reading: Reading | null = null;

  private readonly tipId = uniqueId("wt-relative-time");

  @query("button") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement;

  constructor() {
    super();
    // On the host, so moving from the phrase onto the exact time (in this shadow tree) is no leave.
    this.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch" && this.popup && !this.#isOpen()) this.#show();
    });
    this.addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "touch" && !this.#pinned) this.#hide();
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The clock moved on while it was off the page.
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#stopWatching();
    super.disconnectedCallback();
  }

  override willUpdate(): void {
    const at = Date.parse(this.datetime);
    if (Number.isNaN(at)) {
      this.#reading = null;
      return;
    }
    const locale = this.locale || undefined;
    const { value, unit, changesIn } = read(at, this.now().getTime(), this.future);
    this.#reading = {
      // Zero is the only value worded by "auto" ("now"): any other keeps its number, because
      // "auto" turns one day into "yesterday" whatever the calendar says.
      words: new Intl.RelativeTimeFormat(locale, {
        numeric: value === 0 ? "auto" : "always",
      }).format(value, unit),
      exact: new Intl.DateTimeFormat(locale, {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: this.timeZone || undefined,
      }).format(at),
      changesIn,
    };
  }

  override updated(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const changesIn = this.#reading?.changesIn;
    if (this.isConnected && changesIn != null)
      this.#timer = setTimeout(() => this.requestUpdate(), changesIn);
  }

  /** Read from the popover itself: its toggle event, and so `open`, arrives a task later. */
  #isOpen(): boolean {
    return this.popup.matches(":popover-open");
  }

  #show(): void {
    // Shown synchronously so the box has real dimensions to place before the first paint.
    this.popup.showPopover();
    this.#place();
    this.open = true;
    document.addEventListener("keydown", this.onDocumentKeydown, { capture: true });
    document.addEventListener("focusin", this.onDocumentFocusin, { capture: true });
  }

  #hide(): void {
    this.#pinned = false;
    this.#stopWatching();
    this.popup?.hidePopover();
  }

  private onClick(event: MouseEvent): void {
    // `popovertarget` exempts this button from light-dismiss; its own native toggle is suppressed.
    event.preventDefault();
    if (this.#isOpen() && this.#pinned) {
      this.#hide();
      return;
    }
    this.#pinned = true;
    if (!this.#isOpen()) this.#show();
  }

  /** Also how a close the browser made itself (a click elsewhere) is heard. */
  private onToggle(event: ToggleEvent): void {
    this.open = event.newState === "open";
    if (!this.open) {
      this.#pinned = false;
      this.#stopWatching();
    }
  }

  #stopWatching(): void {
    document.removeEventListener("keydown", this.onDocumentKeydown, { capture: true });
    document.removeEventListener("focusin", this.onDocumentFocusin, { capture: true });
  }

  /** Escape closes only this, never an enclosing dismissible dialog too (as wt-help-tooltip). */
  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    this.#hide();
    this.trigger.focus();
  };

  private readonly onDocumentFocusin = (event: FocusEvent): void => {
    if (!event.composedPath().includes(this)) this.#hide();
  };

  /** Below the phrase and centred on it, above it where the window has no room below, and always
   * 8px inside the window. No gap, so the mouse can move onto it without leaving. */
  #place(): void {
    const anchor = this.trigger.getBoundingClientRect();
    const box = this.popup.getBoundingClientRect();
    const centred = anchor.left + anchor.width / 2 - box.width / 2;
    const below = anchor.bottom + box.height <= innerHeight - 8;
    this.popup.style.left = `${Math.max(8, Math.min(centred, innerWidth - box.width - 8))}px`;
    this.popup.style.top = `${Math.max(8, below ? anchor.bottom : anchor.top - box.height)}px`;
  }

  override render() {
    const reading = this.#reading;
    if (reading === null) return nothing;
    // Unformatted: a line break before the words would be drawn, and underlined, as a space.
    // prettier-ignore
    return html`<button
        type="button"
        aria-describedby=${this.tipId}
        aria-expanded=${this.open}
        popovertarget=${this.tipId}
        @click=${this.onClick}
      ><time datetime=${this.datetime}>${reading.words}</time></button
      ><span id=${this.tipId} popover role="tooltip" @toggle=${this.onToggle}
        >${reading.exact}</span
      >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-relative-time": WtRelativeTime;
  }
}
