import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import type { CloudRecoveryView } from "../api/client.js";
import { dispatchSetupGoto } from "../events.js";
import { errorStyles, fieldStyles } from "../form-styles.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { oldBoxProblem, oldBoxQuestion } from "./old-box-question.js";

@customElement("setup-cloud-restore-screen")
export class SetupCloudRestoreScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    errorStyles,
    css`
      :host {
        display: block;
      }
      .code {
        font-size: 1.8rem;
        letter-spacing: 0.15em;
        font-weight: 700;
      }
      .warning {
        border-left: 4px solid currentColor;
        padding: 0.5rem 1rem;
      }
    `,
  ];
  @property({ attribute: false }) view?: CloudRecoveryView;
  @property() errorMessage?: string;
  @property({ type: Boolean }) busy = false;
  /** Set by the shell from `restore.stream_source_live`: when the old server last wrote to its bucket. */
  @property() liveSince?: string;
  /** Set by the shell from `restore.stream_source_unchecked`. */
  @property({ type: Boolean }) liveUnknown = false;
  @state() private acknowledged = false;
  @state() private oldBoxGone = false;
  @state() private showError = false;
  #approvalBinding?: string;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #currentApprovalBinding(): string | undefined {
    return this.view?.state === "approved" && this.view.point
      ? JSON.stringify([this.view.requestId, this.view.point])
      : undefined;
  }

  override willUpdate(): void {
    const binding = this.#currentApprovalBinding();
    if (binding !== this.#approvalBinding) {
      this.acknowledged = false;
      this.oldBoxGone = false;
      this.showError = false;
      this.#approvalBinding = binding;
    }
  }

  get #askingOldBox(): boolean {
    return this.liveSince !== undefined || this.liveUnknown;
  }

  get #oldBoxUnanswered(): boolean {
    return this.#askingOldBox && !this.oldBoxGone;
  }

  #problems(): string[] {
    return [
      !this.acknowledged ? t("cloud_restore.acknowledge_missing") : "",
      this.#oldBoxUnanswered ? oldBoxProblem() : "",
    ].filter(Boolean);
  }

  #action(action: "start" | "status" | "start-again" | "restore"): void {
    if (this.busy) return;
    if (action === "restore") {
      if (
        this.view?.state !== "approved" ||
        !this.view.point ||
        this.#currentApprovalBinding() !== this.#approvalBinding
      )
        return;
      if (this.#problems().length > 0) {
        this.showError = true;
        return;
      }
    }
    this.showError = false;
    this.dispatchEvent(
      new CustomEvent("cloud-restore-action", {
        detail: {
          action,
          ...(action === "restore"
            ? { pointId: this.view!.point!.id, oldBoxGone: this.#askingOldBox && this.oldBoxGone }
            : {}),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const approved = this.view?.state === "approved" && this.view.point;
    const acknowledgeInvalid = this.showError && !this.acknowledged;
    return html`
      <h1>${t("cloud_restore.heading")}</h1>
      <p>${t("cloud_restore.intro")}</p>
      ${
        !this.view
          ? html`
              <wt-button
                variant="primary"
                data-test="start"
                ?disabled=${this.busy}
                @click=${() => this.#action("start")}
                >${t("cloud_restore.start")}</wt-button
              >
            `
          : this.view.state === "expired"
            ? html`
                <p>${t("cloud_restore.expired")}</p>
                <wt-button
                  variant="primary"
                  data-test="start-again"
                  ?disabled=${this.busy}
                  @click=${() => this.#action("start-again")}
                  >${t("cloud_restore.start_again")}</wt-button
                >
              `
            : html`
                <p>${t("cloud_restore.enter_code")}</p>
                <p class="code" data-test="code">${this.view.code}</p>
                <p>${t("cloud_restore.expires")} <time>${this.view.expiresAt}</time></p>
                <p>
                  <a
                    data-test="open-cloud"
                    href=${this.view.openCloudUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    >${t("cloud_restore.open_cloud")}</a
                  >
                </p>
                <wt-button
                  data-test="check"
                  ?disabled=${this.busy}
                  @click=${() => this.#action("status")}
                  >${t("cloud_restore.check")}</wt-button
                >
                ${
                  approved
                    ? html`
                        <h2>${t("cloud_restore.approved_heading")}</h2>
                        <p>${t("cloud_restore.captured")} <time>${approved.capturedAt}</time></p>
                        <p class="warning">${t("cloud_restore.later_changes")}</p>
                        <label class="field"
                          ><input
                            name="no-running-server"
                            type="checkbox"
                            required
                            data-test="acknowledge"
                            aria-invalid=${acknowledgeInvalid ? "true" : "false"}
                            aria-describedby=${acknowledgeInvalid ? "acknowledge-error" : nothing}
                            .checked=${this.acknowledged}
                            @change=${(event: Event) => {
                              this.acknowledged = (event.currentTarget as HTMLInputElement).checked;
                            }}
                          />
                          ${t("cloud_restore.acknowledge")}</label
                        >
                        ${acknowledgeInvalid ? html`<p class="error" id="acknowledge-error">${t("cloud_restore.acknowledge_missing")}</p>` : nothing}
                        ${oldBoxQuestion({
                          liveSince: this.liveSince,
                          liveUnknown: this.liveUnknown,
                          checked: this.oldBoxGone,
                          invalid: this.showError && this.#oldBoxUnanswered,
                          onChange: (checked) => {
                            this.oldBoxGone = checked;
                          },
                        })}
                        ${
                          this.showError
                            ? html`<wt-form-error-summary
                                data-test="error"
                                heading=${t("cloud_restore.error_heading")}
                                .errors=${this.#problems()}
                              ></wt-form-error-summary>`
                            : nothing
                        }
                        <p>
                          <wt-button
                            variant="primary"
                            data-test="restore"
                            ?disabled=${this.busy}
                            @click=${() => this.#action("restore")}
                            >${t("cloud_restore.restore")}</wt-button
                          >
                        </p>
                      `
                    : nothing
                }
              `
      }
      ${this.errorMessage && !this.showError ? html`<p class="error" role="alert" data-test="server-error">${this.errorMessage}</p>` : nothing}
      <wt-form-actions
        ><wt-button slot="cancel" variant="ghost" @click=${() => dispatchSetupGoto(this, "restore")}
          >${t("cloud_restore.back")}</wt-button
        ></wt-form-actions
      >
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-cloud-restore-screen": SetupCloudRestoreScreen;
  }
}
