import { LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { TickingClock } from "@waitron/ui";
import { t } from "../i18n/t.js";

/** "Fired N min ago". Its clock runs only while it is on the page, so a screen that is not showing a
 * fired group's age is never redrawn for one. */
@customElement("till-fired-ago")
export class TillFiredAgo extends LitElement {
  @property() firedAt = "";
  /** Injectable clock; unset reads the ticking clock. */
  @property({ attribute: false }) now?: number;

  readonly #clock = new TickingClock(this);

  /** Light DOM: the text is part of the row it sits in. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected override render(): string {
    const now = this.now ?? this.#clock.now;
    const minutes = Math.max(0, Math.floor((now - Date.parse(this.firedAt)) / 60_000));
    return t("table.group_fired_ago").replace("{n}", String(minutes));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-fired-ago": TillFiredAgo;
  }
}
