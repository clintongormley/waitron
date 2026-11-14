import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  ModulePromotionEntry,
  SetupContribution,
} from "@waitron/module/src/setup-contract.js";
import { SETUP_MODULES } from "@waitron/dashboard-modules/setup";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-textarea.js";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import {
  SetupApi,
  type HandoverStatus,
  type HandoverSignIn,
  type EmergencyHandoverPreview,
  type EmergencyHandoverDeclaration,
} from "../api/client.js";
import { makeSetupId } from "../random-id.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

const activated = (status?: HandoverStatus) =>
  status?.role === "destination" &&
  ["activated", "return_pending", "return_complete", "return_abandoned"].includes(status.state);
const closed = (status?: HandoverStatus) =>
  status !== undefined && ["abandoned", "replaced"].includes(status.state);

@customElement("setup-handover-screen")
export class SetupHandoverScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        max-width: 70ch;
        padding: var(--wt-space-5);
        overflow-wrap: anywhere;
      }
      wt-input,
      wt-textarea {
        display: block;
        margin-bottom: var(--wt-space-3);
      }
      h1 {
        font-size: var(--wt-font-size-xl);
        margin-top: 0;
      }
      .statements label {
        display: flex;
        align-items: start;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-3);
        min-height: var(--wt-tap-min);
      }
      input[type="checkbox"] {
        accent-color: var(--wt-color-primary);
        flex-shrink: 0;
      }
      h2 {
        font-size: var(--wt-font-size-lg);
      }
      a {
        color: var(--wt-color-primary-text);
      }
    `,
  ];
  @property({ attribute: false }) api = new SetupApi();
  @property() operationId = "";
  @property({ type: Boolean }) emergency = false;
  @state() private copyPreview?: EmergencyHandoverPreview;
  @state() private backup?: File;
  @state() private backupKey = "";
  @state() private needsBackupKey = false;
  @state() private backupRestarting = false;
  @state() private reason = "";
  @state() private statements = {
    sourceSwitchedOff: false,
    noParallelRecovery: false,
    missingTailAccepted: false,
  };
  @state() private refusalLink = "";
  @state() private copyRefused = false;
  @state() private declarationSaved = false;
  #pendingDeclaration?: Omit<EmergencyHandoverDeclaration, "signIn">;
  get #isEmergency(): boolean {
    return this.emergency || this.status?.scenario === "emergency";
  }
  get #declared(): boolean {
    return this.declarationSaved || this.status?.scenario === "emergency";
  }
  @state() private status?: HandoverStatus;
  @state() private readFailed = false;
  @state() private restarting = false;
  @property({ attribute: false }) contributions: readonly SetupContribution[] = SETUP_MODULES;
  @state() private email = "";
  @state() private password = "";
  @state() private code = "";
  @state() private attempted = false;
  @state() private actionError = "";
  @state() private busy = false;
  /**
   * Activation waits for Try again, keeping the chosen minute: the box refused the sign-in, or the
   * fields failed their check when the series became ready.
   */
  @state() private activationHeld = false;
  @state() private entry?: ModulePromotionEntry;
  #signInChecked = false;
  #restorePage = (event: PageTransitionEvent): void => {
    if (event.persisted) this.#restartPolling();
  };
  #controller?: AbortController;
  #timer?: ReturnType<typeof setTimeout>;
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  override connectedCallback(): void {
    super.connectedCallback();
    this.#restartPolling();
    window.addEventListener("pagehide", this.#leavePage);
    window.addEventListener("pageshow", this.#restorePage);
  }
  #restartPolling(): void {
    this.#controller?.abort();
    clearTimeout(this.#timer);
    const controller = new AbortController();
    this.#controller = controller;
    if (this.operationId) void this.#poll(controller);
    else if (this.backupRestarting) void this.#waitForBackup(controller);
  }
  override disconnectedCallback(): void {
    window.removeEventListener("pagehide", this.#leavePage);
    window.removeEventListener("pageshow", this.#restorePage);
    this.#leavePage();
    super.disconnectedCallback();
  }
  #leavePage = (): void => {
    this.#controller?.abort();
    clearTimeout(this.#timer);
    this.#resetSelection();
    this.password = this.code = "";
    this.backup = undefined;
    this.backupKey = "";
    this.backupRestarting = this.restarting = false;
    this.#signInChecked = false;
    this.copyPreview = undefined;
    this.declarationSaved = false;
    this.reason = "";
    this.statements = {
      sourceSwitchedOff: false,
      noParallelRecovery: false,
      missingTailAccepted: false,
    };
    this.#pendingDeclaration = undefined;
  };
  async #poll(controller: AbortController): Promise<void> {
    try {
      const status = await this.api.handoverStatus(this.operationId, controller.signal);
      if (controller.signal.aborted) return;
      this.status = status;
      if (activated(status) || closed(status)) {
        this.restarting = false;
        this.#resetSelection();
        this.password = this.code = "";
      }
      this.readFailed = false;
    } catch {
      if (controller.signal.aborted) return;
      this.readFailed = true;
    }
    if (!controller.signal.aborted && !activated(this.status) && !closed(this.status)) {
      this.#timer = setTimeout(() => void this.#poll(controller), 2000);
    }
  }
  #resetSelection(): void {
    this.entry?.clear();
    this.entry = undefined;
    this.activationHeld = false;
  }
  #signIn(): HandoverSignIn {
    return {
      email: this.email.trim(),
      password: this.password,
      ...(this.code.trim() ? { totp: this.code.trim() } : {}),
    };
  }
  #valid(): boolean {
    return this.email.includes("@") && this.password !== "";
  }
  /** Marks the fields and focuses the first one that fails; false means send nothing. */
  async #checked(): Promise<boolean> {
    this.attempted = true;
    if (this.#valid()) return true;
    await this.updateComplete;
    await focusFirstInvalid(this.shadowRoot!);
    return false;
  }
  async #authenticate(): Promise<void> {
    if (this.busy || (this.#isEmergency && this.copyRefused) || !(await this.#checked())) return;
    this.actionError = "";
    this.#resetSelection();
    this.#prepareClock();
  }
  #prepareClock(): void {
    const contribution = this.contributions.filter((item) => item.createPromotion);
    const status = this.status;
    if (
      contribution.length !== 1 ||
      !status ||
      (!status.copyPlaced && status.scenario !== "emergency")
    )
      return;
    const binding = {
      module: contribution[0]!.module,
      action: "promote",
      eventId: status.operationId,
      sourceId: status.sourceNodeId,
      targetNodeId: status.destinationNodeId,
    };
    // Each request reads the fields again: a code typed after a refusal carries on the same check.
    this.entry = contribution[0]!.createPromotion!({
      locale: currentLocale().startsWith("es") ? "es" : "en",
      binding,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      prepare: async (proposal) => {
        if (!this.#valid()) {
          this.attempted = true;
          // ClockWait.settle takes a TypeError with no code as a lost request: during a wait the
          // entry keeps waiting and checks again at its next turn; a check the person pressed shows
          // the entry's failure. Nothing is sent either way.
          throw new TypeError("sign-in fields incomplete");
        }
        try {
          return await this.api.prepareHandover(
            this.operationId,
            this.#signIn(),
            binding,
            proposal,
          );
        } catch (cause) {
          if (this.#isEmergency) this.actionError = this.#emergencyError(cause);
          throw cause;
        }
      },
    });
  }
  async #retry(): Promise<void> {
    if (!this.busy && (await this.#checked())) await this.#activate();
  }
  async #activate(): Promise<void> {
    const entry = this.entry;
    const moduleOperation = entry?.readOperation();
    if (!entry || !moduleOperation || this.busy) return;
    if (!this.#valid()) {
      this.attempted = true;
      this.activationHeld = true;
      return;
    }
    const controller = this.#controller;
    this.busy = true;
    this.actionError = "";
    this.activationHeld = false;
    try {
      const answer = await this.api.activateHandover(
        this.operationId,
        this.#signIn(),
        moduleOperation,
      );
      if (controller?.signal.aborted) return;
      this.restarting = answer.restarting;
      this.#resetSelection();
      this.password = this.code = "";
      this.#restartPolling();
    } catch (cause) {
      if (controller?.signal.aborted) return;
      this.actionError = this.#isEmergency
        ? this.#emergencyError(cause)
        : entry.refusalMessage(cause);
      if ((cause as { code?: unknown } | null)?.code === "password.invalid") {
        this.activationHeld = true;
        return;
      }
      this.#resetSelection();
      if (
        this.#isEmergency &&
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "handover.copy_mismatch"
      ) {
        try {
          await this.#readPreview();
        } catch (failure) {
          this.actionError = this.#emergencyError(failure);
        }
      }
      this.#restartPolling();
    } finally {
      this.busy = false;
    }
  }
  #emergencyError(cause: unknown): string {
    const error = cause as {
      code?: string;
      params?: { operationId?: string; sourceServersUrl?: string };
    } | null;
    const code = error?.code;
    this.refusalLink =
      typeof error?.params?.operationId === "string"
        ? `/handover/${encodeURIComponent(error.params.operationId)}`
        : code === "handover.source_still_answering"
          ? (error?.params?.sourceServersUrl ?? this.copyPreview?.sourceServersUrl ?? "")
          : "";
    this.copyRefused = [
      "handover.copy_damaged",
      "handover.chain_broken",
      "handover.copy_check_failed",
      "handover.copy_mismatch",
    ].includes(code ?? "");
    if (code === "password.invalid" && this.code && this.#signInChecked)
      return t("handover.emergency.code_expired");
    if (code === "password.invalid" || code === "totp.required")
      return t("handover.emergency.sign_in_failed");
    if (code === "password.throttled") return t("handover.emergency.throttled");
    if (code === "authorization.not_permitted") return t("handover.emergency.permission");
    if (code === "handover.source_still_answering") return t("handover.emergency.source_answered");
    if (code === "handover.controlled_unresolved") return t("handover.emergency.controlled");
    if (code === "handover.copy_predates_destination")
      return t("handover.emergency.backup_too_old");
    if (code === "handover.backup_key_missing" || code === "backup.recovery_key_too_short")
      return t("handover.emergency.backup_key_missing");
    if (
      ["recovery.passphrase_invalid", "backup.artifact_invalid", "backup.archive_invalid"].includes(
        code ?? "",
      )
    )
      return t("handover.emergency.backup_invalid");
    if (this.copyRefused) return t("handover.emergency.copy_failed");
    if (
      ["node.read_only", "handover.source_no_longer_main", "handover.step_out_of_order"].includes(
        code ?? "",
      )
    )
      return t("handover.emergency.changed");
    if (code === "handover.source_not_established" || code === "handover.peer_unknown")
      return t("handover.emergency.trust");
    return t("handover.emergency.failed");
  }
  async #resume(operationId: string): Promise<void> {
    const controller = this.#controller;
    this.operationId = operationId;
    this.declarationSaved = true;
    history.replaceState(null, "", `/handover/${encodeURIComponent(operationId)}`);
    try {
      const status = await this.api.handoverStatus(operationId, controller?.signal);
      if (controller?.signal.aborted) return;
      this.status = status;
      if (activated(status) || closed(status)) {
        this.#resetSelection();
        this.password = this.code = "";
      }
      this.readFailed = false;
    } catch {
      if (!controller?.signal.aborted) this.readFailed = true;
    }
    if (!controller?.signal.aborted) this.#restartPolling();
  }
  async #readPreview(): Promise<boolean> {
    const controller = this.#controller;
    const preview = await this.api.previewEmergencyHandover(this.#signIn());
    if (controller?.signal.aborted) return false;
    this.copyPreview = preview;
    this.#signInChecked = true;
    this.copyRefused = false;
    this.refusalLink = "";
    if (preview.operation !== null && preview.operation.reason !== null) {
      this.reason = preview.operation.reason;
      await this.#resume(preview.operation.operationId);
      return true;
    }
    return false;
  }
  async #previewCopy(): Promise<void> {
    if (this.busy || !this.#valid()) return;
    if (this.#controller?.signal.aborted) this.#restartPolling();
    this.busy = true;
    this.actionError = "";
    try {
      await this.#readPreview();
    } catch (cause) {
      this.actionError = this.#emergencyError(cause);
    } finally {
      this.busy = false;
    }
  }
  async #waitForBackup(controller: AbortController): Promise<void> {
    try {
      await this.#readPreview();
      if (controller.signal.aborted) return;
      if (this.copyPreview?.copy.source !== "selected-backup")
        throw new TypeError("copy not placed");
      this.backupRestarting = this.restarting = this.busy = false;
    } catch (cause) {
      if (controller.signal.aborted) return;
      const code = (cause as { code?: string }).code;
      if (code && code !== "handover.copy_mismatch") {
        this.actionError = this.#emergencyError(cause);
        this.backupRestarting = this.restarting = this.busy = false;
        return;
      }
      this.#timer = setTimeout(() => void this.#waitForBackup(controller), 2000);
    }
  }
  async #selectBackup(): Promise<void> {
    if (this.busy || !this.backup || !this.#valid() || (this.needsBackupKey && !this.backupKey))
      return;
    this.busy = true;
    this.actionError = "";
    try {
      await this.api.selectEmergencyBackup(
        this.backup,
        this.#signIn(),
        this.backupKey || undefined,
      );
      this.backup = undefined;
      this.backupKey = "";
      this.copyPreview = undefined;
      this.#pendingDeclaration = undefined;
      this.statements = {
        sourceSwitchedOff: false,
        noParallelRecovery: false,
        missingTailAccepted: false,
      };
      this.backupRestarting = this.restarting = true;
      this.#restartPolling();
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      if (code === "handover.backup_key_missing") this.needsBackupKey = true;
      this.actionError = this.#emergencyError(cause);
      this.busy = false;
    }
  }
  #validDeclaration(): boolean {
    return (
      this.#valid() &&
      this.reason.trim() !== "" &&
      this.reason.length <= 500 &&
      Object.values(this.statements).every(Boolean)
    );
  }
  async #declareEmergency(): Promise<void> {
    if (this.busy || !this.#validDeclaration() || this.copyRefused) return;
    this.busy = true;
    this.actionError = "";
    try {
      if (this.#pendingDeclaration && (await this.#readPreview())) {
        this.#prepareClock();
        return;
      }
      this.#pendingDeclaration ??= {
        operationId: makeSetupId(),
        expectedCopy: this.copyPreview!.copy,
        reason: this.reason,
        locale: currentLocale().startsWith("es") ? "es" : "en",
        statements: {
          sourceSwitchedOff: true,
          noParallelRecovery: true,
          missingTailAccepted: true,
        },
      };
      await this.api.declareEmergencyHandover({
        ...this.#pendingDeclaration,
        signIn: this.#signIn(),
      });
      await this.#resume(this.#pendingDeclaration.operationId);
      if (this.isConnected) this.#prepareClock();
    } catch (cause) {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "handover.copy_mismatch" &&
        !this.#declared
      ) {
        this.#pendingDeclaration = undefined;
        this.statements = {
          sourceSwitchedOff: false,
          noParallelRecovery: false,
          missingTailAccepted: false,
        };
        try {
          await this.#readPreview();
          this.actionError = t("handover.emergency.copy_changed");
        } catch (failure) {
          this.actionError = this.#emergencyError(failure);
        }
        return;
      }
      if (typeof cause !== "object" || cause === null || !("code" in cause)) {
        try {
          if (await this.#readPreview()) {
            this.#prepareClock();
            return;
          }
        } catch (failure) {
          this.actionError = this.#emergencyError(failure);
        }
      }
      if (!this.actionError) this.actionError = this.#emergencyError(cause);
    } finally {
      this.busy = false;
    }
  }
  #emergencyContent() {
    const preview = this.copyPreview;
    if (!preview) return nothing;
    const date = preview.copy.lastChangeAtMs;
    return html`<section data-test="emergency-copy" data-wording-version="a1018-emergency-v1">
      <h2>
        ${t(preview.copy.source === "selected-backup" ? "handover.emergency.selected_backup" : "handover.emergency.copy")}
      </h2>
      <p>${preview.copy.identifier}</p>
      <p>
        ${date === null ? t("handover.emergency.no_date") : html`${t("handover.emergency.latest_activity")} ${new Date(date).toLocaleString(currentLocale())}`}
      </p>
      <p><a href=${preview.sourceServersUrl}>${t("handover.emergency.servers")}</a></p>
      ${
        this.#declared
          ? html`<p>${t("handover.emergency.saved")}</p>
              <p>${this.reason}</p>
              ${preview.operation?.declaredAtMs ? html`<p>${t("handover.emergency.declared_at")} ${new Date(preview.operation.declaredAtMs).toLocaleString(currentLocale())}</p>` : nothing}`
          : html` ${preview.operation ? html`<p><a href=${`/handover/${encodeURIComponent(preview.operation.operationId)}`}>${t("handover.emergency.controlled_link")}</a></p>` : nothing}
              <p>${t("handover.emergency.one_way")}</p>
              <p>${t("handover.emergency.split")}</p>
              <p>${t("handover.emergency.returned")}</p>
              <div class="statements">
                ${(["sourceSwitchedOff", "noParallelRecovery", "missingTailAccepted"] as const).map(
                  (key) =>
                    html`<label
                      ><input
                        type="checkbox"
                        name=${key}
                        required
                        .checked=${this.statements[key]}
                        ?disabled=${this.busy || !!this.#pendingDeclaration}
                        @change=${(event: Event) => {
                          this.statements = {
                            ...this.statements,
                            [key]: (event.currentTarget as HTMLInputElement).checked,
                          };
                        }}
                      /><span
                        >${t(`handover.emergency.${key}`)} <span aria-hidden="true">*</span></span
                      ></label
                    >`,
                )}
              </div>
              <wt-textarea
                name="emergency-reason"
                label=${t("handover.emergency.reason")}
                required
                .value=${this.reason}
                ?disabled=${this.busy || !!this.#pendingDeclaration}
                .error=${this.reason.length > 500 ? t("handover.emergency.reason_long") : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  this.reason = event.detail.value;
                }}
              ></wt-textarea>`
      }
    </section>`;
  }
  #fields() {
    const field = (
      name: "email" | "password" | "code",
      key: "handover.email" | "handover.password" | "handover.code",
    ) =>
      html`<wt-input
        name=${`handover-${name}`}
        label=${t(key)}
        type=${name === "password" ? "password" : name === "email" ? "email" : "text"}
        autocomplete=${name === "code" ? "one-time-code" : name === "email" ? "username" : "current-password"}
        .value=${this[name]}
        ?required=${name !== "code"}
        ?disabled=${this.busy}
        .error=${this.attempted && name !== "code" && (name === "email" ? !this.email.includes("@") : !this.password) ? t("handover.required") : ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (name !== "code") this.#signInChecked = false;
          if (name === "email") this.#resetSelection();
          if (name === "email" && event.detail.value !== this.email) {
            this.password = this.code = "";
            this.copyPreview = undefined;
            this.declarationSaved = false;
            this.reason = "";
            this.statements = {
              sourceSwitchedOff: false,
              noParallelRecovery: false,
              missingTailAccepted: false,
            };
            this.#pendingDeclaration = undefined;
            this.#restartPolling();
          }
          this[name] = event.detail.value;
          this.actionError = "";
        }}
      ></wt-input>`;
    return html`<p>${t(this.#isEmergency ? "handover.emergency.sign_in" : "handover.sign_in")}</p>
      ${field("email", "handover.email")}${field("password", "handover.password")}${field("code", "handover.code")}
      ${
        this.#isEmergency && !this.#declared && !this.copyPreview?.operation
          ? html`
              <p>${t("handover.emergency.backup_intro")}</p>
              <label
                >${t("handover.emergency.backup_file")}
                <input
                  name="handover-backup"
                  type="file"
                  ?disabled=${this.busy}
                  @change=${(event: Event) => {
                    this.backup = (event.currentTarget as HTMLInputElement).files?.[0];
                    this.actionError = "";
                  }}
              /></label>
              ${
                this.needsBackupKey
                  ? html`<wt-input
                      name="handover-backup-key"
                      type="password"
                      label=${t("handover.emergency.backup_key")}
                      required
                      .value=${this.backupKey}
                      ?disabled=${this.busy}
                      @wt-change=${(event: CustomEvent<{ value: string }>) => {
                        this.backupKey = event.detail.value;
                        this.actionError = "";
                      }}
                    ></wt-input>`
                  : nothing
              }
            `
          : nothing
      }
      ${this.#isEmergency ? this.#emergencyContent() : nothing}
      ${
        this.entry
          ? html`<p>${t("handover.zone")}</p>
              ${this.entry}
              ${this.busy ? html`<p role="status">${t("handover.starting")}</p>` : nothing}`
          : nothing
      }
      <wt-form-actions
        .error=${this.actionError ? this.actionError : this.reason.length > 500 || (this.attempted && !this.#valid()) ? t("handover.fix") : ""}
      >
        ${this.backup && !this.#declared ? html`<wt-button data-test="emergency-backup" .disabled=${this.busy || !this.#valid() || (this.needsBackupKey && !this.backupKey)} variant=${this.#valid() && (!this.needsBackupKey || this.backupKey) ? "primary" : "secondary"} @click=${() => void this.#selectBackup()}>${t("handover.emergency.use_backup")}</wt-button>` : nothing}
        ${
          this.#isEmergency && !this.copyPreview
            ? html`<wt-button
                data-test="emergency-preview"
                .disabled=${this.busy || !this.#valid()}
                variant=${this.#valid() ? "primary" : "secondary"}
                @click=${() => void this.#previewCopy()}
                >${t("handover.emergency.check")}</wt-button
              >`
            : this.#isEmergency && !this.#declared
              ? html`<wt-button
                  data-test="emergency-declare"
                  .disabled=${this.busy || !this.#validDeclaration() || this.copyRefused}
                  variant=${this.#validDeclaration() && !this.copyRefused ? "danger" : "secondary"}
                  @click=${() => void this.#declareEmergency()}
                  >${t("handover.emergency.declare")}</wt-button
                >`
              : this.entry
                ? this.activationHeld
                  ? html`<wt-button
                      data-test="retry-activation"
                      .disabled=${this.busy || !this.#valid()}
                      variant="primary"
                      @click=${() => void this.#retry()}
                      >${t("handover.try_again")}</wt-button
                    >`
                  : nothing
                : html`<wt-button
                    data-test="authenticate"
                    .disabled=${this.busy || (this.attempted && !this.#valid()) || (this.#isEmergency && (this.copyRefused || !this.status))}
                    variant=${this.busy || (this.#isEmergency && (this.copyRefused || !this.status)) ? "secondary" : "primary"}
                    @click=${() => void this.#authenticate()}
                    >${t("handover.compare")}</wt-button
                  >`
        }
      </wt-form-actions>
      ${this.#isEmergency ? html`<p>${this.refusalLink ? html`<a href=${this.refusalLink}>${t("handover.emergency.progress")}</a>` : nothing} <a href="/">${t("handover.emergency.stop")}</a></p>` : nothing}`;
  }
  override render() {
    const status = this.status;
    return html`<main
      lang=${currentLocale()}
      @recovery-edit-details=${(event: Event) => {
        event.stopPropagation();
        this.#resetSelection();
      }}
      @promotion-change=${() => {
        if (!this.activationHeld && this.entry?.readOperation()) void this.#activate();
      }}
    >
      <h1>${t("handover.heading")}</h1>
      ${
        activated(status)
          ? html`<p role="status">${t("handover.done")}</p>
              <a href="/">${t("handover.continue")}</a>`
          : closed(status)
            ? html`<p role="status">${t("handover.closed")}</p>`
            : this.restarting
              ? html`<p role="status">
                  ${t(this.backupRestarting ? "handover.emergency.backup_restarting" : "handover.restarting")}
                </p>`
              : this.#isEmergency ||
                  (status?.role === "destination" &&
                    status.copyPlaced &&
                    status.scenario === "controlled")
                ? this.#fields()
                : html`<p role="status">${t(status ? "handover.copy" : "handover.loading")}</p>`
      }
      ${status?.waitingReason ? html`<p role="status">${t(status.waitingReason === "storage.disk_full" || status.waitingReason === "handover.no_room_to_place" ? "handover.space" : status.waitingReason === "handover.source_unreachable" ? "handover.source" : "handover.wait")}</p>` : nothing}
      ${this.readFailed && !this.restarting ? html`<p role="status">${t("handover.read_failed")}</p>` : nothing}
    </main>`;
  }
}
