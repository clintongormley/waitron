import { LitElement, type PropertyValues, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, pageTitleStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, errorStyles, helpLinkStyles, statusStyles } from "../form-styles.js";
import { dispatchResetRequested, dispatchSetupGoto } from "../events.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { t } from "../i18n/t.js";

export interface ResetScreenOutcome {
  kind: "resetting" | "refused";
  message: string;
}

@customElement("setup-reset-screen")
export class SetupResetScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    errorStyles,
    statusStyles,
    helpLinkStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  @property({ type: Boolean }) busy = false;

  /** A refusal of the reset; it never disables the reset. */
  @property() errorMessage?: string;
  /** A new value means a new refusal: it shows `errorMessage` again after the person pressed it away. A language change rewords `errorMessage` without changing this. */
  @property({ attribute: false }) refusal?: unknown;

  /** Set once the reset is staged or cannot run; the form is replaced by it. */
  @property({ attribute: false }) outcome?: ResetScreenOutcome;

  /** The main box's Servers page, from the address typed in this tab; unset when not known. */
  @property({ attribute: false }) serversUrl?: string;

  @property({ attribute: false }) reload: () => void = location.reload.bind(location);

  @state() private refusalDismissed = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("refusal")) this.refusalDismissed = false;
  }

  #reset(): void {
    if (this.busy) return;
    this.refusalDismissed = true;
    dispatchResetRequested(this);
  }

  override render(): TemplateResult {
    if (this.outcome !== undefined) {
      const resetting = this.outcome.kind === "resetting";
      return html`
        <h1>${t(resetting ? "reset.heading_resetting" : "reset.heading")}</h1>
        <p
          class=${resetting ? "status" : "error"}
          role=${resetting ? "status" : "alert"}
          data-test="outcome"
        >
          ${this.outcome.message}
        </p>
        <div class="actions">
          <wt-button variant="primary" data-test="reload" @click=${() => this.reload()}
            >${t("reset.reload")}</wt-button
          >
        </div>
      `;
    }
    const bottom = this.refusalDismissed ? "" : (this.errorMessage ?? "");
    return html`
      <h1>${t("reset.heading")}</h1>
      <p>${t("reset.explanation")}</p>
      <p data-test="remove-from-list">
        ${
          this.serversUrl === undefined
            ? t("reset.remove_plain")
            : html`${t("reset.remove_before")}
                <a
                  data-test="servers-link"
                  href=${this.serversUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  >${t("reset.servers_link")}</a
                >
                ${t("reset.remove_after")}`
        }
      </p>
      <wt-form-actions .error=${bottom}>
        <wt-button
          variant="ghost"
          slot="cancel"
          data-test="back"
          @click=${() => dispatchSetupGoto(this, "provisioning")}
          >${t("reset.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="reset"
          ?disabled=${this.busy}
          @click=${() => this.#reset()}
          >${t(this.busy ? "reset.busy" : "reset.submit")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-reset-screen": SetupResetScreen;
  }
}
