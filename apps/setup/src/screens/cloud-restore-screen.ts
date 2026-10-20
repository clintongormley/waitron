import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { SetupApi } from "../api/client.js";
import type { RecoveryEntryField } from "./recovery-allocation.js";
import { SetupRecoveryCopy } from "./recovery-copy.js";
import type { CloudRecoveryView } from "../api/client.js";
import { dispatchSetupGoto } from "../events.js";
import { errorStyles, fieldStyles } from "../form-styles.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { oldBoxQuestion } from "./old-box-question.js";

/** The one field the screen shows that a refusal of the Cloud restore can name. */
export type CloudField = "oldBoxGone" | RecoveryEntryField;

export interface CloudRestoreConfirmation {
  approvalBinding: string | undefined;
  acknowledged: boolean;
  oldBoxGone: boolean;
}

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
        font-size: var(--wt-font-size-xl);
        letter-spacing: var(--wt-space-1);
        font-weight: var(--wt-font-weight-bold);
      }
      .warning {
        border-inline-start: var(--wt-space-1) solid var(--wt-color-border);
        padding: var(--wt-space-2) var(--wt-space-4);
      }
    `,
  ];
  @property({ attribute: false }) api: SetupApi = new SetupApi();
  @property({ attribute: false }) view?: CloudRecoveryView;
  @property({ attribute: false }) retryConfirmation?: CloudRestoreConfirmation;
  @property() errorMessage?: string;
  /** The field `errorMessage` is about. */
  @property() invalidField?: CloudField;
  @property({ type: Boolean }) busy = false;
  /** Set by the shell from `restore.stream_source_live`: when the old server last wrote to its bucket. */
  @property() liveSince?: string;
  /** Set by the shell from `restore.stream_source_unchecked`. */
  @property({ type: Boolean }) liveUnknown = false;
  @state() private acknowledged = false;
  @state() private oldBoxGone = false;
  @state() private attempted = false;
  @state() private recoveryInvalid = false;
  /** The owner pressed an action after `errorMessage` arrived, so it no longer applies. */
  @state() private refusalDismissed = false;
  @state() private fieldRefusalDismissed = false;
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

  readConfirmation(): CloudRestoreConfirmation {
    return {
      approvalBinding: this.#approvalBinding,
      acknowledged: this.acknowledged,
      oldBoxGone: this.oldBoxGone,
    };
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("errorMessage")) this.refusalDismissed = false;
    if (changed.has("invalidField")) this.fieldRefusalDismissed = false;
    const binding = this.#currentApprovalBinding();
    if (binding !== this.#approvalBinding) {
      const confirmation =
        changed.has("retryConfirmation") &&
        binding !== undefined &&
        this.retryConfirmation?.approvalBinding === binding
          ? this.retryConfirmation
          : undefined;
      this.acknowledged = confirmation?.acknowledged ?? false;
      this.oldBoxGone = confirmation?.oldBoxGone ?? false;
      this.attempted = false;
      this.refusalDismissed = false;
      this.fieldRefusalDismissed = false;
      this.#approvalBinding = binding;
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("invalidField") && this.#refusalUnder() !== undefined) {
      void focusFirstInvalid(this.shadowRoot!);
    }
  }

  /** The field showing the server's refusal, if any. */
  #refusalUnder(): CloudField | undefined {
    return this.errorMessage === undefined ||
      this.refusalDismissed ||
      this.fieldRefusalDismissed ||
      !this.#shows(this.invalidField)
      ? undefined
      : this.invalidField;
  }

  /** Whether `field` is on the screen. */
  #shows(field: CloudField | undefined): boolean {
    return (
      field !== undefined &&
      this.view?.state === "approved" &&
      Boolean(this.view.point) &&
      (field !== "oldBoxGone" || this.#askingOldBox)
    );
  }

  get #askingOldBox(): boolean {
    return this.liveSince !== undefined || this.liveUnknown;
  }

  get #oldBoxUnanswered(): boolean {
    return this.#askingOldBox && !this.oldBoxGone;
  }

  get #incomplete(): boolean {
    return !this.acknowledged || this.recoveryInvalid || this.#oldBoxUnanswered;
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
      this.attempted = true;
      if (this.#incomplete) {
        this.refusalDismissed = true;
        void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
        return;
      }
    }
    const credentials =
      action === "restore"
        ? this.shadowRoot!.querySelector<SetupRecoveryCopy>("setup-recovery-copy")?.readCredentials(
            { cloudPointId: this.view?.point?.id, selectionId: this.#currentApprovalBinding() },
          )
        : undefined;
    if (credentials === null) return;
    this.refusalDismissed = true;
    this.dispatchEvent(
      new CustomEvent("cloud-restore-action", {
        detail: {
          action,
          ...credentials,
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
    const acknowledgeInvalid = this.attempted && !this.acknowledged;
    const fieldsInvalid = Boolean(approved) && this.attempted && this.#incomplete;
    const refused = this.#refusalUnder();
    const bottom = [
      ...(this.errorMessage &&
      !this.refusalDismissed &&
      !this.fieldRefusalDismissed &&
      !this.#shows(this.invalidField)
        ? [this.errorMessage]
        : []),
      ...(fieldsInvalid || refused !== undefined ? [t("cloud_restore.fix_fields")] : []),
    ].join(" ");
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
                        <setup-recovery-copy
                          .errorMessage=${!this.refusalDismissed && !this.fieldRefusalDismissed ? this.errorMessage : undefined}
                          .refusedField=${this.invalidField}
                          @recovery-field-edited=${(
                            event: CustomEvent<{ field: RecoveryEntryField }>,
                          ) => {
                            event.stopPropagation();
                            if (event.detail.field === this.invalidField)
                              this.fieldRefusalDismissed = true;
                          }}
                          @recovery-invalid=${(event: CustomEvent<{ invalid: boolean }>) => {
                            event.stopPropagation();
                            this.recoveryInvalid = event.detail.invalid;
                          }}
                          .api=${this.api}
                          .cloudPointId=${approved.id}
                          .selectionId=${this.#currentApprovalBinding()}
                        ></setup-recovery-copy>
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
                          invalid: this.attempted && this.#oldBoxUnanswered,
                          refusal: refused === "oldBoxGone" ? this.errorMessage : undefined,
                          onChange: (checked) => {
                            this.oldBoxGone = checked;
                            if (this.invalidField === "oldBoxGone")
                              this.fieldRefusalDismissed = true;
                          },
                        })}
                      `
                    : nothing
                }
              `
      }
      <wt-form-actions .error=${bottom}
        ><wt-button slot="cancel" variant="ghost" @click=${() => dispatchSetupGoto(this, "restore")}
          >${t("cloud_restore.back")}</wt-button
        >${
          approved
            ? html`<wt-button
                variant="primary"
                data-test="restore"
                ?disabled=${this.busy || fieldsInvalid}
                @click=${() => this.#action("restore")}
                >${t("cloud_restore.restore")}</wt-button
              >`
            : nothing
        }</wt-form-actions
      >
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-cloud-restore-screen": SetupCloudRestoreScreen;
  }
}
