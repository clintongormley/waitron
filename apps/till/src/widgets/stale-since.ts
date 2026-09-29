import { LitElement, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { clockTime, countText, t } from "../i18n/t.js";

const MINUTE_MS = 60_000;

/** "No updates since 10:19, 5 minutes ago". It redraws itself at each minute after `since`, so the
 * count moves on while nothing around it renders; its timer runs only while it is on the page. It
 * keeps its own timeout rather than the shared `TickingClock` because the count must change exactly
 * on the minute boundary, which an interval clock (20 seconds by default) misses by up to its
 * interval. */
@customElement("till-stale-since")
export class TillStaleSince extends LitElement {
  @property({ attribute: false }) since = new Date();

  #timer?: ReturnType<typeof setTimeout>;

  /** Light DOM: the text is part of the banner it sits in. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // A reconnect after time has passed must redraw, which also restarts the timer.
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.#timer);
  }

  #elapsed(): number {
    return Date.now() - this.since.getTime();
  }

  // A clock set back can put `since` ahead of now; that reads as under a minute, not a negative count.
  #minutes(): number {
    return Math.max(0, Math.floor(this.#elapsed() / MINUTE_MS));
  }

  protected override render(): string {
    const time = clockTime(this.since);
    const minutes = this.#minutes();
    const ago =
      minutes === 0
        ? t("station.stale_ago_under_minute")
        : countText(minutes, "station.stale_ago", "station.stale_ago_one");
    return t("station.stale")
      .replace("{time}", () => time)
      .replace("{ago}", () => ago);
  }

  protected override updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    clearTimeout(this.#timer);
    if (!this.isConnected) return;
    const nextMinute = (this.#minutes() + 1) * MINUTE_MS - this.#elapsed();
    this.#timer = setTimeout(() => this.requestUpdate(), nextMinute);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-stale-since": TillStaleSince;
  }
}
