import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { fill, t } from "../i18n/t.js";

/** Asks before a theme goes on every screen. The screen sends the change on
 * `theme-switch-confirm`, sets `busy` while it is sent, and closes the dialog by setting `open`. */
@customElement("dashboard-theme-switch-dialog")
export class ThemeSwitchDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      p {
        margin: 0 0 var(--wt-space-3);
      }
      ul {
        margin: 0;
        padding-inline-start: var(--wt-space-5);
        display: grid;
        gap: var(--wt-space-2);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property() name = "";
  @property({ attribute: false }) lines: string[] = [];
  @property({ type: Boolean }) busy = false;
  @property() error = "";
  @property({ attribute: false }) opener: HTMLElement | null = null;
  // `wt-dialog` reports a close made from script one task later, and drops that report when the
  // dialog is opened again first, so a reopening disarms this.
  #closedByScript = false;
  // Holds a second press until the screen answers the first by going busy, or with a refusal.
  #confirmed = false;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open")) {
      this.#closedByScript = !this.open && changed.get("open") === true;
      if (this.open) this.#confirmed = false;
    }
    if ((changed.has("busy") && !this.busy) || (changed.has("error") && this.error)) {
      this.#confirmed = false;
    }
  }

  #send(choice: "confirm" | "back"): void {
    this.dispatchEvent(
      new CustomEvent(`theme-switch-${choice}`, { bubbles: true, composed: true }),
    );
  }

  #use(): void {
    if (!this.open || this.busy || this.#confirmed) return;
    this.#confirmed = true;
    this.#send("confirm");
  }

  #back(): void {
    if (!this.open || this.busy) return;
    this.open = false;
    this.#send("back");
  }

  #closed(): void {
    if (this.#closedByScript) {
      this.#closedByScript = false;
      return;
    }
    this.open = false;
    this.#send("back");
  }

  override render() {
    return html`<wt-dialog
      .open=${this.open}
      .opener=${this.opener}
      .dismissible=${!this.busy}
      heading=${fill("appearance.switch_heading", { name: this.name })}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#closed();
      }}
    >
      <p>${t("appearance.switch_body")}</p>
      ${
        this.lines.length === 0
          ? nothing
          : html`<p>${t("appearance.switch_hard_to_read")}</p>
              <ul>
                ${this.lines.map((line) => html`<li>${line}</li>`)}
              </ul>`
      }
      <wt-form-actions slot="footer" .error=${this.error}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="switch-back"
          ?disabled=${this.busy}
          @click=${() => this.#back()}
          >${t("action.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="switch-use"
          ?disabled=${this.busy}
          ?loading=${this.busy}
          @click=${() => this.#use()}
          >${t("appearance.use_it")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-theme-switch-dialog": ThemeSwitchDialog;
  }
}
