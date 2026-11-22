import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, pageTitleStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-choice-row.js";
import "@waitron/ui/src/components/wt-switch.js";
import { actionsStyles } from "../form-styles.js";
import { dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

/**
 * A provisioned live venue is never turned into a demo, so Live goes through a warning and an
 * "I understand" confirm rather than advancing on one click.
 */
@customElement("setup-mode-screen")
export class SetupModeScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }

      .other-box {
        margin: var(--wt-space-3) 0 0;
        font-weight: var(--wt-font-weight-bold);
      }

      .choices {
        margin-top: var(--wt-space-4);
      }

      h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }

      h2.others {
        margin: var(--wt-space-5) 0 0;
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text-muted);
      }

      .others + .choices {
        margin-top: var(--wt-space-2);
      }

      .warning {
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
      }

      .confirm {
        margin-top: var(--wt-space-4);
      }

      .understand {
        display: block;
        margin: var(--wt-space-3) 0;
      }
    `,
  ];

  /** Set while another box answers the venue's name on this network. */
  @property({ type: Boolean }) otherBoxFound = false;

  @property() installationOrigin?: "usb";

  @property() environment?: "production" | "preproduction";

  @property({ attribute: false }) beforeChoice?: (
    mode: "demo" | "prepare" | "live" | undefined,
    proceed: () => void,
    signal: AbortSignal,
  ) => void;

  #choiceAbort = new AbortController();

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.#choiceAbort.signal.aborted) this.#choiceAbort = new AbortController();
  }

  override disconnectedCallback(): void {
    this.#choiceAbort.abort();
    super.disconnectedCallback();
  }

  @state() private confirming = false;

  @state() private understood = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #advance(mode: "demo" | "prepare" | "live"): void {
    this.#requestChoice(mode, () => {
      dispatchSetupPatch(this, { mode });
      dispatchSetupGoto(this, "admin");
    });
  }

  #requestChoice(mode: "demo" | "prepare" | "live" | undefined, proceed: () => void): void {
    if (!this.isConnected) return;
    if (this.beforeChoice) this.beforeChoice(mode, proceed, this.#choiceAbort.signal);
    else proceed();
  }

  #chooseDemo(): void {
    this.#advance("demo");
  }

  #choosePrepare(): void {
    this.#advance("prepare");
  }

  /** Joining or recovering is not a fresh primary, so it writes no mode. */
  #chooseExisting(screen: "role" | "connect" | "restore"): void {
    this.#requestChoice(undefined, () => dispatchSetupGoto(this, screen));
  }

  #chooseLive(): void {
    this.confirming = true;
  }

  #onUnderstood(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.understood = event.detail.checked;
  }

  #confirmLive(): void {
    if (!this.understood) return;
    this.#requestChoice("live", () => {
      dispatchSetupPatch(this, { mode: "live" });
      dispatchSetupGoto(this, "live-source");
    });
  }

  #cancelLive(): void {
    this.#choiceAbort.abort();
    this.#choiceAbort = new AbortController();
    this.confirming = false;
    this.understood = false;
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("mode.heading")}</h1>
      ${this.confirming ? this.#renderConfirm() : this.#renderChoices()}
    `;
  }

  #renderChoices(): TemplateResult {
    const found = this.otherBoxFound;
    return html`
      ${
        found
          ? html`<p class="other-box" data-test="other-box">${t("mode.other_box")}</p>
              <div class="choices">
                <wt-choice-row
                  data-test="choose-join-spare"
                  heading=${t("mode.join_spare.heading")}
                  @click=${() => this.#chooseExisting("connect")}
                  >${t("mode.join_spare.copy")}</wt-choice-row
                >
              </div>
              <h2 class="others">${t("mode.others.heading")}</h2>`
          : nothing
      }
      <div class="choices">
        ${
          this.environment === "production" || this.installationOrigin === "usb"
            ? nothing
            : html`<wt-choice-row
                data-test="choose-demo"
                heading=${t("mode.demo.heading")}
                @click=${() => this.#chooseDemo()}
                >${t("mode.demo.copy")}</wt-choice-row
              >`
        }
        ${
          this.environment === "production"
            ? nothing
            : html`<wt-choice-row
                data-test="choose-prepare"
                heading=${t("mode.prepare.heading")}
                @click=${() => this.#choosePrepare()}
                >${t("mode.prepare.copy")}</wt-choice-row
              >`
        }
        <wt-choice-row
          data-test="choose-live"
          heading=${t("mode.live.heading")}
          @click=${() => this.#chooseLive()}
          >${t("mode.live.copy")}</wt-choice-row
        >
        ${
          found
            ? html`<wt-choice-row
                data-test="choose-recover"
                heading=${t("mode.recover.heading")}
                @click=${() => this.#chooseExisting("restore")}
                >${t("mode.recover.copy")}</wt-choice-row
              >`
            : html`<wt-choice-row
                data-test="choose-existing"
                heading=${t("mode.existing.heading")}
                @click=${() => this.#chooseExisting("role")}
                >${t("mode.existing.copy")}</wt-choice-row
              >`
        }
      </div>
    `;
  }

  #renderConfirm(): TemplateResult {
    return html`
      <wt-card raised class="confirm">
        <h2>${t("mode.confirm.heading")}</h2>
        <p class="warning" role="alert" data-test="live-warning">${t("mode.confirm.warning")}</p>
        <wt-switch
          class="understand"
          data-test="understand"
          label=${t("mode.confirm.understand")}
          .checked=${this.understood}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onUnderstood(e)}
        ></wt-switch>
        <div class="actions">
          <wt-button variant="ghost" data-test="live-cancel" @click=${() => this.#cancelLive()}
            >${t("mode.confirm.back")}</wt-button
          >
          <wt-button
            variant="danger"
            data-test="confirm-live"
            ?disabled=${!this.understood}
            @click=${() => this.#confirmLive()}
            >${t("mode.confirm.button")}</wt-button
          >
        </div>
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-mode-screen": SetupModeScreen;
  }
}
