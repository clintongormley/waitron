import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { countText, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

/** The red strip a till shows while the venue's main box has been silent too long; with `panel`, it
 * fills the screen instead. */
@customElement("till-main-server-strip")
export class TillMainServerStrip extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .strip {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
      }
      .words {
        flex: 1 1 auto;
      }
      .words p {
        margin: 0;
      }
      .heading {
        font-weight: var(--wt-font-weight-bold);
      }
      .carries-on {
        flex: 1 1 100%;
        margin: 0;
        font-size: var(--wt-font-size-sm);
      }
      :host([panel]) .strip {
        position: fixed;
        inset: 0;
        z-index: 1;
        overflow: auto;
        flex-direction: column;
        flex-wrap: nowrap;
        /* Plain centring pushes the heading above the scrollable area once the content outgrows a short screen. */
        justify-content: safe center;
        gap: var(--wt-space-4);
        padding: var(--wt-space-5);
        text-align: center;
      }
      :host([panel]) .words,
      :host([panel]) .carries-on {
        flex: none;
        max-width: var(--wt-till-form-column-width);
      }
      :host([panel]) .heading {
        margin-block-end: var(--wt-space-2);
        font-size: var(--wt-font-size-xl);
      }
      :host([panel]) .last-contact {
        font-size: var(--wt-font-size-lg);
      }
      :host([panel]) wt-button {
        width: 100%;
        max-width: var(--wt-till-form-column-width);
      }
      :host([panel]) wt-button::part(button) {
        background: var(--wt-color-on-danger);
        color: var(--wt-color-danger);
        border-color: var(--wt-color-on-danger);
      }
      :host([panel]) wt-button::part(button):hover:not(:disabled) {
        border-color: var(--wt-color-danger);
      }
      :host([panel]) .carries-on {
        font-size: var(--wt-font-size-md);
      }
    `,
  ];

  @property({ type: Boolean }) spareAnswering = false;
  @property({ type: Boolean }) showSwitch = false;
  @property({ type: Boolean }) refused = false;
  @property({ type: Boolean }) showCloud = false;
  @property({ type: Boolean }) cloudBusy = false;
  @property({ type: Boolean }) cloudRefused = false;
  /** When the main box was first found silent; the last contact is drawn only while it is set. */
  @property({ attribute: false }) silentSince: number | null = null;
  /** When the main box last answered; the last contact counts up from it once a second. */
  @property({ attribute: false }) lastAnsweredAt: number | null = null;
  @property({ type: Boolean, reflect: true }) panel = false;

  #tick: ReturnType<typeof setInterval> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#syncTick();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#syncTick();
  }

  override updated(): void {
    this.#syncTick();
  }

  #syncTick(): void {
    if (this.isConnected && this.silentSince !== null) {
      this.#tick ??= setInterval(() => this.requestUpdate(), 1_000);
    } else {
      clearInterval(this.#tick);
      this.#tick = undefined;
    }
  }

  #lastContact(): string {
    // With no answer since the page loaded, the first unanswered probe is the earliest moment known.
    const since = this.lastAnsweredAt ?? this.silentSince ?? 0;
    const seconds = Math.max(0, Math.floor((Date.now() - since) / 1_000));
    return seconds < 60
      ? countText(seconds, "server.last_contact_seconds", "server.last_contact_seconds_one")
      : countText(
          Math.floor(seconds / 60),
          "server.last_contact_minutes",
          "server.last_contact_minutes_one",
        );
  }

  override render() {
    const switchable = this.spareAnswering && this.showSwitch;
    const answering = (this.showCloud && this.cloudRefused) || (switchable && this.refused);
    return html`<div class="strip" role="alert" data-main-server-strip>
      <div class="words">
        <p class="heading">
          ${t(
            this.showCloud && this.cloudRefused
              ? "cloud_emergency.main_answering"
              : switchable && this.refused
                ? "server.main_still_answering"
                : this.spareAnswering
                  ? "server.main_silent"
                  : "server.none_answering",
          )}
        </p>
        ${
          answering || this.silentSince === null
            ? nothing
            : html`<p class="last-contact" aria-live="off" data-last-contact>
                ${this.#lastContact()}
              </p>`
        }
      </div>
      ${
        switchable
          ? html`<wt-button
              variant="secondary"
              size=${this.panel ? "lg" : "md"}
              data-switch-to-spare
              @click=${() =>
                this.dispatchEvent(
                  new CustomEvent("switch-to-spare", { bubbles: true, composed: true }),
                )}
              >${t("server.switch_to_spare")}</wt-button
            >`
          : nothing
      }
      ${
        this.showCloud
          ? html`<wt-button
              variant="secondary"
              size=${this.panel ? "lg" : "md"}
              data-start-in-cloud
              .loading=${this.cloudBusy}
              @click=${() => this.dispatchEvent(new CustomEvent("start-in-cloud", { bubbles: true, composed: true }))}
              >${t("cloud_emergency.start")}</wt-button
            >`
          : nothing
      }
      ${answering ? nothing : html`<p class="carries-on" data-carries-on>${t("server.carries_on")}</p>`}
      <slot></slot>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-main-server-strip": TillMainServerStrip;
  }
}
