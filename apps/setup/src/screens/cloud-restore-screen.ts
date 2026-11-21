import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { FormFeedback, baseStyles, pageTitleStyles, bottomMessage, focusFirstInvalid } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { SetupApi } from "../api/client.js";
import type { RecoveryEntryField } from "./recovery-allocation.js";
import { SetupRecoveryCopy } from "./recovery-copy.js";
import type { CloudRecoveryView } from "../api/client.js";
import { dispatchSetupGoto, type CloudRestoreActionDetail } from "../events.js";
import { errorStyles, fieldStyles } from "../form-styles.js";
import { localTime, t } from "../i18n/t.js";
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
    pageTitleStyles,
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
      h2 {
        font-size: var(--wt-font-size-lg);
      }
    `,
  ];
  @property({ attribute: false }) api: SetupApi = new SetupApi();
  @property({ attribute: false }) boxAddress?: string;
  @property({ attribute: false }) view?: CloudRecoveryView;
  @property({ attribute: false }) retryConfirmation?: CloudRestoreConfirmation;
  @property() errorMessage?: string;
  /** A new value means a new refusal: it shows `errorMessage` again after the person pressed it away. A language change rewords `errorMessage` without changing this. */
  @property({ attribute: false }) refusal?: unknown;
  /** The field `errorMessage` is about. */
  @property() invalidField?: CloudField;
  @property({ type: Boolean }) busy = false;
  /** Set by the shell from `restore.stream_source_live`: when the old server last wrote to its bucket. */
  @property() liveSince?: string;
  /** Set by the shell from `restore.stream_source_unchecked`. */
  @property({ type: Boolean }) liveUnknown = false;
  @state() private acknowledged = false;
  @state() private oldBoxGone = false;
  /** As `setup-recovery-copy` last announced. */
  @state() private reviewNeeded = false;
  @state() private recoveryInvalid = false;
  private readonly feedback = new FormFeedback(this);
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
    if (changed.has("refusal")) this.feedback.newRefusal("refusal");
    if (changed.has("invalidField")) this.feedback.newRefusal("field");
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
      this.feedback.reset();
      this.#approvalBinding = binding;
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("invalidField") && this.#refusalUnder(this.#shownRefusal) !== undefined) {
      void focusFirstInvalid(this.shadowRoot!);
    }
  }

  /** The server's refusal, unless the owner has dismissed it. */
  get #shownRefusal(): string | undefined {
    return this.feedback.shows("refusal") && this.feedback.shows("field")
      ? this.errorMessage
      : undefined;
  }

  /** The field showing `refusal`, if any. */
  #refusalUnder(refusal: string | undefined): CloudField | undefined {
    return refusal === undefined || !this.#shows(this.invalidField) ? undefined : this.invalidField;
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
      this.feedback.press();
      if (this.#incomplete) {
        this.feedback.dismiss("refusal");
        void this.feedback.focus(this.shadowRoot!);
        return;
      }
    }
    const detail: CloudRestoreActionDetail | undefined =
      action === "restore" ? this.#restoreDetail() : { action };
    if (!detail) return;
    this.feedback.dismiss("refusal");
    this.dispatchEvent(
      new CustomEvent("cloud-restore-action", { detail, bubbles: true, composed: true }),
    );
  }

  #restoreDetail(): CloudRestoreActionDetail | undefined {
    const credentials = this.shadowRoot!.querySelector<SetupRecoveryCopy>(
      "setup-recovery-copy",
    )?.readCredentials({
      cloudPointId: this.view?.point?.id,
      selectionId: this.#currentApprovalBinding(),
    });
    return credentials
      ? {
          action: "restore",
          ...credentials,
          pointId: this.view!.point!.id,
          oldBoxGone: this.#askingOldBox && this.oldBoxGone,
        }
      : undefined;
  }

  override render() {
    const approved = this.view?.state === "approved" && this.view.point;
    const acknowledgeInvalid = this.feedback.attempted && !this.acknowledged;
    const fieldsInvalid = Boolean(approved) && this.feedback.attempted && this.#incomplete;
    const shownRefusal = this.#shownRefusal;
    const refused = this.#refusalUnder(shownRefusal);
    const bottom = bottomMessage(
      this.#shows(this.invalidField) ? null : (shownRefusal ?? null),
      fieldsInvalid || refused !== undefined ? t("cloud_restore.fix_fields") : null,
      approved && this.reviewNeeded ? t("restore.review_first") : null,
    );
    return html`
      <h1>${t("cloud_restore.heading")}</h1>
      <p>${t("cloud_restore.intro")}</p>
      <p>${t("restore.replace_warning")}</p>
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
                <p>
                  ${t("cloud_restore.expires")}
                  <time datetime=${this.view.expiresAt}
                    >${localTime(this.view.expiresAt) ?? this.view.expiresAt}</time
                  >
                </p>
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
                        <p>
                          ${t("cloud_restore.captured")}
                          <time datetime=${approved.capturedAt}
                            >${localTime(approved.capturedAt) ?? approved.capturedAt}</time
                          >
                        </p>
                        <setup-recovery-copy
                          .errorMessage=${shownRefusal}
                          .refusedField=${this.invalidField}
                          @recovery-field-edited=${(
                            event: CustomEvent<{ field: RecoveryEntryField }>,
                          ) => {
                            event.stopPropagation();
                            if (event.detail.field === this.invalidField)
                              this.feedback.dismiss("field");
                          }}
                          @recovery-invalid=${(event: CustomEvent<{ invalid: boolean }>) => {
                            event.stopPropagation();
                            this.recoveryInvalid = event.detail.invalid;
                          }}
                          @recovery-review-needed=${(event: CustomEvent<{ needed: boolean }>) => {
                            event.stopPropagation();
                            this.reviewNeeded = event.detail.needed;
                          }}
                          .api=${this.api}
                          .boxAddress=${this.boxAddress}
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
                          invalid: this.feedback.attempted && this.#oldBoxUnanswered,
                          refusal: refused === "oldBoxGone" ? this.errorMessage : undefined,
                          onChange: (checked) => {
                            this.oldBoxGone = checked;
                            if (this.invalidField === "oldBoxGone") this.feedback.dismiss("field");
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
                ?disabled=${this.busy || fieldsInvalid || this.reviewNeeded}
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
