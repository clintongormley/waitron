import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { t } from "../i18n/t.js";

type Choice = "back" | "save-anyway" | "fix-and-save";

@customElement("dashboard-hard-to-read-dialog")
export class HardToReadDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      ul {
        margin: 0;
        padding-inline-start: var(--wt-space-5);
        display: grid;
        gap: var(--wt-space-2);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) lines: string[] = [];
  @property({ type: Boolean }) canFix = false;
  @property({ attribute: false }) opener: HTMLElement | null = null;
  // `wt-dialog` reports a close made from script a frame later, and drops that report when the
  // dialog is opened again first, so a reopening disarms this.
  #closedByButton = false;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && this.open) this.#closedByButton = false;
  }
  #send(choice: Choice): void {
    this.dispatchEvent(
      new CustomEvent(`hard-to-read-${choice}`, { bubbles: true, composed: true }),
    );
  }
  #press(choice: Choice): void {
    if (!this.open) return;
    this.#closedByButton = true;
    this.open = false;
    this.#send(choice);
  }
  #closed(): void {
    if (this.#closedByButton) {
      this.#closedByButton = false;
      return;
    }
    this.open = false;
    this.#send("back");
  }

  override render() {
    return html`<wt-dialog
      .open=${this.open}
      .opener=${this.opener}
      heading=${t("appearance.dialog_heading")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#closed();
      }}
    >
      <ul>
        ${this.lines.map((line) => html`<li>${line}</li>`)}
      </ul>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="back"
          @click=${() => this.#press("back")}
          >${t("action.back")}</wt-button
        >
        <wt-button
          slot=${this.canFix ? "secondary" : nothing}
          variant=${this.canFix ? "secondary" : "primary"}
          data-test="save-anyway"
          @click=${() => this.#press("save-anyway")}
          >${t("appearance.save_anyway")}</wt-button
        >
        ${
          this.canFix
            ? html`<wt-button
                data-test="fix-and-save"
                variant="primary"
                @click=${() => this.#press("fix-and-save")}
                >${t("appearance.fix_and_save")}</wt-button
              >`
            : nothing
        }
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-hard-to-read-dialog": HardToReadDialog;
  }
}
