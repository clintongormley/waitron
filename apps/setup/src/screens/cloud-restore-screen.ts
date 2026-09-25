import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { CloudRecoveryView } from "../api/client.js";
import { dispatchSetupGoto } from "../events.js";
import { errorStyles, fieldStyles } from "../form-styles.js";
import { oldBoxQuestion } from "./old-box-question.js";

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

  #action(action: "start" | "status" | "start-again" | "restore"): void {
    if (this.busy) return;
    if (
      action === "restore" &&
      (!this.acknowledged ||
        this.#oldBoxUnanswered ||
        this.view?.state !== "approved" ||
        !this.view.point ||
        this.#currentApprovalBinding() !== this.#approvalBinding)
    ) {
      this.showError = true;
      return;
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
    return html`
      <h1>Restore from Waitron Cloud</h1>
      <p>
        Use a verified snapshot for a preparation or demo venue. Stop the old server and any
        surviving peers before restoring. Changes after the snapshot time will be lost.
      </p>
      ${
        !this.view
          ? html`
              <wt-button
                variant="primary"
                data-test="start"
                ?disabled=${this.busy}
                @click=${() => this.#action("start")}
                >Start Cloud recovery</wt-button
              >
            `
          : this.view.state === "expired"
            ? html`
                <p>This recovery request has expired.</p>
                <wt-button
                  variant="primary"
                  data-test="start-again"
                  ?disabled=${this.busy}
                  @click=${() => this.#action("start-again")}
                  >Start a new request</wt-button
                >
              `
            : html`
                <p>Enter this code in your Waitron Cloud account:</p>
                <p class="code" data-test="code">${this.view.code}</p>
                <p>Request expires: <time>${this.view.expiresAt}</time></p>
                <p>
                  <a
                    data-test="open-cloud"
                    href=${this.view.openCloudUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    >Open Waitron Cloud</a
                  >
                </p>
                <wt-button
                  data-test="check"
                  ?disabled=${this.busy}
                  @click=${() => this.#action("status")}
                  >Check approval</wt-button
                >
                ${
                  approved
                    ? html`
                        <h2>Approved snapshot</h2>
                        <p>Captured: <time>${approved.capturedAt}</time></p>
                        <p class="warning">Later changes will not be in this restored venue.</p>
                        <label
                          ><input
                            type="checkbox"
                            data-test="acknowledge"
                            .checked=${this.acknowledged}
                            @change=${(event: Event) => {
                              this.acknowledged = (event.currentTarget as HTMLInputElement).checked;
                            }}
                          />
                          I confirm the old server and surviving peers are stopped, and I accept
                          losing changes after this snapshot.</label
                        >
                        ${this.showError && !this.acknowledged ? html`<p role="alert">Confirm before restoring.</p>` : nothing}
                        ${oldBoxQuestion({
                          liveSince: this.liveSince,
                          liveUnknown: this.liveUnknown,
                          checked: this.oldBoxGone,
                          invalid: this.showError && this.#oldBoxUnanswered,
                          onChange: (checked) => {
                            this.oldBoxGone = checked;
                          },
                        })}
                        <p>
                          <wt-button
                            variant="primary"
                            data-test="restore"
                            ?disabled=${this.busy}
                            @click=${() => this.#action("restore")}
                            >Restore this snapshot</wt-button
                          >
                        </p>
                      `
                    : nothing
                }
              `
      }
      ${this.errorMessage ? html`<p role="alert" data-test="server-error">${this.errorMessage}</p>` : nothing}
      <wt-form-actions
        ><wt-button slot="cancel" variant="ghost" @click=${() => dispatchSetupGoto(this, "restore")}
          >Back to backup file</wt-button
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
