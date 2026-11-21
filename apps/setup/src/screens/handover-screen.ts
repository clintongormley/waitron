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
import "@waitron/ui/src/components/wt-file-input.js";
import "@waitron/ui/src/components/wt-segmented-control.js";
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import {
  SetupApi,
  type HandoverStatus,
  type HandoverSignIn,
  type EmergencyHandoverPreview,
  type EmergencyHandoverDeclaration,
  type FollowedCopyTake,
} from "../api/client.js";
import { makeSetupId } from "../random-id.js";
import { currentLocale, format, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { fileInputCopy } from "../file-input-copy.js";

const activated = (status?: HandoverStatus) =>
  status?.role === "destination" &&
  ["activated", "return_pending", "return_complete", "return_abandoned"].includes(status.state);
const closed = (status?: HandoverStatus) =>
  status !== undefined && ["abandoned", "replaced"].includes(status.state);
/** Take refusals the copy this spare holds can still answer, and how each is worded. */
const FOLLOWED_REFUSALS: Partial<Record<string, StringKey>> = {
  "handover.copy_predates_destination": "handover.emergency.followed_not_admitted",
  "provisioning.database_ahead": "handover.emergency.followed_ahead",
  "restore.schema_too_new": "handover.emergency.followed_ahead",
  "handover.chain_broken": "handover.emergency.followed_failed",
  "handover.copy_damaged": "handover.emergency.followed_failed",
  "handover.copy_check_failed": "handover.emergency.followed_failed",
};
const HELD_OFFER_AFTER_MS = 60_000;
const MAIN_CHECK_MS = 3000;
/** Refusals the copy the take signs in against may answer differently: it can be newer. */
const HELD_SIGN_IN_REFUSALS = new Set([
  "password.invalid",
  "totp.required",
  "authorization.not_permitted",
  "passkey.not_registered",
  "passkey.verification_failed",
]);

/** Refusals the person answers by signing in again, so the folded sign-in opens. */
const SIGN_IN_REFUSAL_KEYS = new Set<StringKey>([
  "handover.emergency.passkey_failed",
  "handover.emergency.code_expired",
  "handover.emergency.sign_in_failed",
  "handover.emergency.throttled",
  "handover.emergency.permission",
]);
/** Refusals a fresh passkey answer can lift: no proof cookie, a lapsed one, or a used challenge. */
const PROOF_REFUSALS = new Set(["password.invalid", "passkey.challenge_expired"]);
class PasskeyNotUsed extends Error {}

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
      wt-textarea,
      wt-file-input,
      wt-segmented-control {
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
  /** Read once: the page later replaces its address with the operation's. */
  @property({ attribute: false }) pageUrl = location.href;
  @state() private copyPreview?: EmergencyHandoverPreview;
  /** A checked copy folds the sign-in and backup choice away; later steps still send the sign-in. */
  @state() private signInOpen = true;
  @state() private backup?: File;
  @state() private backupKey = "";
  @state() private needsBackupKey = false;
  @state() private backupRestarting = false;
  @state() private followRestarting = false;
  /** Waiting for the spare's followed copy to catch up, asking again every 2 seconds. */
  @state() private following = false;
  /**
   * The copy this spare holds, read before the take; offered once the take waits or is refused, and
   * never to a person it refused.
   */
  @state() private heldCopy?: EmergencyHandoverPreview;
  @state() private heldOffered = false;
  /** A refused take restarts the box; the held copy is offered once the box answers again. */
  @state() private heldWaiting = false;
  /** A copy placed earlier is not the main box's latest once the person chose it as the held copy. */
  @state() private heldChosen = false;
  #heldTimer?: ReturnType<typeof setTimeout>;
  @state() private reason = "";
  @state() private statements = {
    sourceSwitchedOff: false,
    noParallelRecovery: false,
    missingTailAccepted: false,
  };
  @state() private refusalLink = "";
  @state() private copyRefused = false;
  @state() private declarationSaved = false;
  /** The device's own check of the main server, before the switch is offered (4d plan, D5). */
  @state() private mainCheck: "checking" | { serversUrl: string } | "clear" = "clear";
  #mainCheckController?: AbortController;
  #pendingDeclaration?: Omit<EmergencyHandoverDeclaration, "signIn">;
  get #isEmergency(): boolean {
    return this.emergency || this.status?.scenario === "emergency";
  }
  get #checksMain(): boolean {
    return this.emergency && !this.operationId;
  }
  get #back(): string | undefined {
    const page = new URL(this.pageUrl);
    const back = URL.parse(page.searchParams.get("back") ?? "");
    const venue = /^box-[^.]+\./.test(page.hostname)
      ? page.hostname.slice(page.hostname.indexOf(".") + 1)
      : page.hostname;
    return back?.protocol === "https:" && page.hostname.includes(".") && back.hostname === venue
      ? back.href
      : undefined;
  }
  get #leaveHref(): string {
    return (this.#isEmergency && this.#back) || "/";
  }
  get #declared(): boolean {
    return this.declarationSaved || this.status?.scenario === "emergency";
  }
  get #signInShown(): boolean {
    return !this.copyPreview || this.signInOpen || (this.attempted && !this.#valid());
  }
  #leaveLink() {
    return html`<a href=${this.#leaveHref}
      >${t(this.#declared ? "handover.emergency.leave_saved" : "handover.emergency.leave")}</a
    >`;
  }
  @state() private status?: HandoverStatus;
  @state() private readFailed = false;
  @state() private restarting = false;
  @property({ attribute: false }) contributions: readonly SetupContribution[] = SETUP_MODULES;
  @state() private usePasskey = false;
  /** Sent until a step answers it; never written to storage or the address. */
  #assertion?: unknown;
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
    if (!event.persisted) return;
    this.#restartPolling();
    if (this.#checksMain) this.#startMainCheck();
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
    if (this.#checksMain) this.#startMainCheck();
    window.addEventListener("pagehide", this.#leavePage);
    window.addEventListener("pageshow", this.#restorePage);
  }
  #restartPolling(): void {
    this.#controller?.abort();
    clearTimeout(this.#timer);
    clearTimeout(this.#heldTimer);
    const controller = new AbortController();
    this.#controller = controller;
    if (this.operationId) void this.#poll(controller);
    else if (this.backupRestarting || this.followRestarting) void this.#waitForPlaced(controller);
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
    this.#assertion = undefined;
    this.backup = undefined;
    this.backupKey = "";
    this.backupRestarting = this.followRestarting = this.restarting = false;
    clearTimeout(this.#heldTimer);
    this.following = this.heldOffered = this.heldWaiting = this.heldChosen = false;
    this.heldCopy = undefined;
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
  #startMainCheck(): void {
    this.mainCheck = "checking";
    void this.#checkMain();
  }
  /**
   * True when the main server stayed silent and no later check replaced this one. Any answer at all
   * means the main server is up; a failure or the deadline lets the page go on: a device that cannot
   * trust or resolve the main server always lands here, and the spare's own check still guards every
   * step.
   */
  async #checkMain(): Promise<boolean> {
    this.#mainCheckController?.abort();
    const controller = new AbortController();
    this.#mainCheckController = controller;
    let limit: ReturnType<typeof setTimeout> | undefined;
    const serversUrl = await Promise.race([
      this.#askMain(controller.signal),
      new Promise<undefined>((resolve) => {
        limit = setTimeout(() => resolve(undefined), MAIN_CHECK_MS);
      }),
    ]);
    clearTimeout(limit);
    controller.abort();
    if (this.#mainCheckController !== controller) return false;
    this.mainCheck = serversUrl === undefined ? "clear" : { serversUrl };
    return serversUrl === undefined;
  }
  /** The main server's Servers page when it answers; never rejects. */
  async #askMain(signal: AbortSignal): Promise<string | undefined> {
    try {
      const { mainUrl } = await this.api.mainServer(signal);
      if (typeof mainUrl !== "string" || mainUrl === "") return undefined;
      const serversUrl = new URL("/servers", mainUrl).href;
      await this.api.probeMain(mainUrl, signal);
      return serversUrl;
    } catch {
      return undefined;
    }
  }
  #mainCheckContent(check: "checking" | { serversUrl: string }) {
    if (check === "checking")
      return html`<p role="status">${t("handover.emergency.main_checking")}</p>`;
    return html`<p role="alert">${t("handover.emergency.main_answering")}</p>
      <p><a href=${check.serversUrl}>${check.serversUrl}</a></p>
      <wt-form-actions>
        <wt-button
          data-test="main-check-again"
          variant="primary"
          @click=${() => this.#startMainCheck()}
          >${t("handover.emergency.main_check_again")}</wt-button
        >
      </wt-form-actions>
      <p>${this.#leaveLink()}</p>`;
  }
  #resetSelection(): void {
    this.entry?.clear();
    this.entry = undefined;
    this.activationHeld = false;
  }
  #signIn(): HandoverSignIn | undefined {
    if (this.usePasskey)
      return this.#assertion === undefined ? undefined : { passkey: this.#assertion };
    return {
      email: this.email.trim(),
      password: this.password,
      ...(this.code.trim() ? { totp: this.code.trim() } : {}),
    };
  }
  /**
   * With the passkey a step first leans on the proof cookie, which the page cannot read, and unlocks
   * once when the spare refuses. An answer uses up the passkey answer sent, except a take still
   * catching up, which signs nobody in.
   */
  async #step<T>(
    send: (signIn: HandoverSignIn | undefined) => Promise<T>,
    unlock = true,
  ): Promise<T> {
    try {
      const answer = await send(this.#signIn());
      if ((answer as Partial<FollowedCopyTake> | undefined)?.state !== "catching-up")
        this.#assertion = undefined;
      return answer;
    } catch (cause) {
      const code = (cause as { code?: unknown } | null)?.code;
      if (typeof code === "string") this.#assertion = undefined;
      if (!this.usePasskey || !unlock || !PROOF_REFUSALS.has(code as string)) throw cause;
    }
    try {
      const { options } = await this.api.switchPasskeyChallenge();
      this.#assertion = await startAuthentication({
        optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
      });
    } catch {
      throw new PasskeyNotUsed();
    }
    return this.#step(send, false);
  }
  #valid(): boolean {
    return this.usePasskey || (this.email.includes("@") && this.password !== "");
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
      scenario: this.#isEmergency ? "emergency" : "controlled",
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
          return await this.#step((signIn) =>
            this.api.prepareHandover(this.operationId, signIn, binding, proposal),
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
      const answer = await this.#step((signIn) =>
        this.api.activateHandover(this.operationId, signIn, moduleOperation),
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
      params?: { operationId?: string; sourceServersUrl?: string; reason?: string; min?: number };
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
    const key = this.#refusalKey(code, error, cause);
    if (SIGN_IN_REFUSAL_KEYS.has(key)) this.signInOpen = true;
    return t(key);
  }
  #refusalKey(
    code: string | undefined,
    error: { params?: { reason?: string } } | null,
    cause: unknown,
  ): StringKey {
    if (
      cause instanceof PasskeyNotUsed ||
      (this.usePasskey &&
        [...PROOF_REFUSALS, "passkey.not_registered", "passkey.verification_failed"].includes(
          code ?? "",
        ))
    )
      return "handover.emergency.passkey_failed";
    if (code === "password.invalid" && this.code && this.#signInChecked)
      return "handover.emergency.code_expired";
    if (code === "password.invalid" || code === "totp.required")
      return "handover.emergency.sign_in_failed";
    if (code === "password.throttled") return "handover.emergency.throttled";
    if (code === "node.operation_page_required") return "handover.emergency.connection";
    if (code === "authorization.not_permitted") return "handover.emergency.permission";
    if (code === "handover.source_still_answering") return "handover.emergency.source_answered";
    if (code === "handover.controlled_unresolved") return "handover.emergency.controlled";
    if (code === "handover.copy_predates_destination") return "handover.emergency.backup_too_old";
    if (code === "restore.archive_resource_limit") return "shell.restore.archive_resource_limit";
    if (code === "restore.manifest_invalid")
      return error?.params?.reason === "unsupported"
        ? "shell.restore.manifest_unsupported"
        : "shell.restore.manifest_invalid";
    if (code === "handover.backup_key_missing") return "handover.emergency.backup_key_missing";
    if (code === "backup.new_recovery_key_too_short")
      return "handover.emergency.backup_key_too_short";
    if (
      ["recovery.passphrase_invalid", "backup.artifact_invalid", "backup.archive_invalid"].includes(
        code ?? "",
      )
    )
      return "handover.emergency.backup_invalid";
    if (this.copyRefused) return "handover.emergency.copy_failed";
    if (
      ["node.read_only", "handover.source_no_longer_main", "handover.step_out_of_order"].includes(
        code ?? "",
      )
    )
      return "handover.emergency.changed";
    if (code === "handover.source_not_established" || code === "handover.peer_unknown")
      return "handover.emergency.trust";
    return "handover.emergency.failed";
  }
  async #resume(operationId: string): Promise<void> {
    const controller = this.#controller;
    this.operationId = operationId;
    this.declarationSaved = true;
    const back = this.#back;
    history.replaceState(
      null,
      "",
      `/handover/${encodeURIComponent(operationId)}${back ? `?back=${encodeURIComponent(back)}` : ""}`,
    );
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
  async #readPreview(unlock = true): Promise<boolean> {
    const controller = this.#controller;
    const preview = await this.#step((signIn) => this.api.previewEmergencyHandover(signIn), unlock);
    if (controller?.signal.aborted) return false;
    return this.#showPreview(preview);
  }
  async #showPreview(preview: EmergencyHandoverPreview): Promise<boolean> {
    this.copyPreview = preview;
    this.signInOpen = false;
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
  /**
   * A saved declaration and a placed backup show; otherwise the take decides, signing in against the
   * copy it takes, which may know a person the copy this spare holds does not.
   */
  async #previewCopy(): Promise<void> {
    if (this.busy || this.following || this.heldWaiting || !this.#valid()) return;
    if (this.#controller?.signal.aborted) this.#restartPolling();
    const controller = this.#controller!;
    this.busy = true;
    this.actionError = "";
    this.heldOffered = this.heldChosen = false;
    try {
      if (this.#checksMain && !(await this.#checkMain())) return;
      let preview: EmergencyHandoverPreview | undefined;
      try {
        preview = await this.#step((signIn) => this.api.previewEmergencyHandover(signIn));
      } catch (cause) {
        if (!HELD_SIGN_IN_REFUSALS.has((cause as { code?: string } | null)?.code ?? ""))
          throw cause;
      }
      if (controller.signal.aborted) return;
      if (preview?.operation != null || preview?.copy.source === "selected-backup") {
        await this.#showPreview(preview);
        return;
      }
      this.heldCopy = preview;
      this.#signInChecked = preview !== undefined;
      this.busy = false;
      this.following = true;
      this.#heldTimer = setTimeout(() => {
        if (!controller.signal.aborted && this.following) this.heldOffered = true;
      }, HELD_OFFER_AFTER_MS);
      await this.#takeFollowed(controller, true);
    } catch (cause) {
      if (!controller.signal.aborted) this.actionError = this.#emergencyError(cause);
    } finally {
      this.busy = false;
    }
  }
  async #takeFollowed(controller: AbortController, unlock = false): Promise<void> {
    let answer: FollowedCopyTake;
    try {
      answer = await this.#step((signIn) => this.api.takeFollowedCopy(signIn), unlock);
    } catch (cause) {
      if (controller.signal.aborted) return;
      this.following = this.heldOffered = false;
      clearTimeout(this.#heldTimer);
      const code = (cause as { code?: string } | null)?.code ?? "";
      const refusal = FOLLOWED_REFUSALS[code];
      if (refusal === undefined) {
        this.actionError = this.#emergencyError(cause);
        // A retry while catching up resends the passkey answer, whose challenge lasts two minutes.
        if (!unlock && code === "passkey.challenge_expired") {
          this.actionError = t("handover.emergency.passkey_lapsed");
          this.signInOpen = true;
        }
      } else {
        this.actionError = t(refusal);
        this.heldWaiting = true;
        this.#timer = setTimeout(() => void this.#waitForHeld(controller), 2000);
      }
      return;
    }
    if (controller.signal.aborted) return;
    if (answer.state === "catching-up") {
      this.#timer = setTimeout(() => void this.#takeFollowed(controller), 2000);
      return;
    }
    clearTimeout(this.#heldTimer);
    this.following = this.heldOffered = false;
    if (answer.state === "taken") {
      try {
        await this.#readPreview();
      } catch (cause) {
        if (!controller.signal.aborted) this.actionError = this.#emergencyError(cause);
      }
      return;
    }
    this.followRestarting = this.restarting = true;
    this.#restartPolling();
  }
  /** Lost answers while the box restarts are retried; any other answer ends the wait. */
  async #waitForHeld(controller: AbortController): Promise<void> {
    try {
      const preview = await this.#step(
        (signIn) => this.api.previewEmergencyHandover(signIn),
        false,
      );
      if (controller.signal.aborted) return;
      this.heldWaiting = false;
      if (preview.operation === null && preview.copy.source !== "selected-backup") {
        this.heldCopy = preview;
        this.heldOffered = true;
      } else await this.#showPreview(preview);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if ((cause as { code?: unknown } | null)?.code === undefined) {
        this.#timer = setTimeout(() => void this.#waitForHeld(controller), 2000);
        return;
      }
      this.heldWaiting = false;
      // A refusal of the passkey path's sign-in leaves the take's explanation in place.
      if (this.usePasskey && PROOF_REFUSALS.has(String((cause as { code: unknown }).code))) {
        if (this.heldCopy === undefined)
          this.actionError = `${this.actionError} ${t("handover.emergency.held_passkey_refused")}`;
        return;
      }
      this.actionError = this.#emergencyError(cause);
    }
  }
  #stopFollowing(): void {
    if (this.following || this.heldWaiting) this.#restartPolling();
    this.following = this.heldWaiting = false;
  }
  async #useHeldCopy(): Promise<void> {
    if (this.busy || !this.#valid()) return;
    this.#restartPolling();
    this.following = this.heldOffered = false;
    this.heldChosen = this.busy = true;
    this.actionError = "";
    await this.#readHeldCopy(this.#controller!, true);
  }
  /** The old process may still have answered the offer's check; a lost answer waits for the restart. */
  async #readHeldCopy(controller: AbortController, unlock = false): Promise<void> {
    try {
      await this.#readPreview(unlock);
      if (controller.signal.aborted) return;
      this.heldWaiting = this.busy = false;
    } catch (cause) {
      if (controller.signal.aborted) return;
      if ((cause as { code?: unknown } | null)?.code === undefined) {
        this.heldWaiting = true;
        this.busy = false;
        this.#timer = setTimeout(() => void this.#readHeldCopy(controller), 2000);
        return;
      }
      this.heldWaiting = this.busy = false;
      this.actionError = this.#emergencyError(cause);
    }
  }
  async #waitForPlaced(controller: AbortController): Promise<void> {
    try {
      await this.#readPreview(false);
      if (controller.signal.aborted) return;
      if (
        this.copyPreview?.copy.source !==
        (this.followRestarting ? "followed-copy" : "selected-backup")
      )
        throw new TypeError("copy not placed");
      this.backupRestarting = this.followRestarting = this.restarting = this.busy = false;
    } catch (cause) {
      if (controller.signal.aborted) return;
      const code = (cause as { code?: string }).code;
      if (code && code !== "handover.copy_mismatch") {
        this.actionError = this.#emergencyError(cause);
        this.backupRestarting = this.followRestarting = this.restarting = this.busy = false;
        return;
      }
      this.#timer = setTimeout(() => void this.#waitForPlaced(controller), 2000);
    }
  }
  async #selectBackup(): Promise<void> {
    if (this.busy || !this.backup || !this.#valid() || (this.needsBackupKey && !this.backupKey))
      return;
    this.#stopFollowing();
    this.busy = true;
    this.actionError = "";
    try {
      const backup = this.backup;
      await this.#step((signIn) =>
        this.api.selectEmergencyBackup(backup, signIn, this.backupKey || undefined),
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
      if (code === "handover.backup_key_missing" || code === "recovery.passphrase_invalid")
        this.needsBackupKey = true;
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
      if (this.#checksMain && !(await this.#checkMain())) return;
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
      const declaration = this.#pendingDeclaration;
      await this.#step((signIn) => this.api.declareEmergencyHandover({ ...declaration, signIn }));
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
  #joinedLine(preview: EmergencyHandoverPreview) {
    return html`<p>
      ${
        preview.joinedAtMs === null
          ? t("handover.emergency.held_undated")
          : format("handover.emergency.held_joined", {
              joined: new Date(preview.joinedAtMs).toLocaleString(currentLocale()),
            })
      }
    </p>`;
  }
  #activityLine(date: number | null) {
    return html`<p>
      ${date === null ? t("handover.emergency.no_date") : html`${t("handover.emergency.latest_activity")} ${new Date(date).toLocaleString(currentLocale())}`}
    </p>`;
  }
  #followContent() {
    if (this.copyPreview) return nothing;
    const held = this.heldOffered ? this.heldCopy : undefined;
    return html`${this.following ? html`<p role="status">${t("handover.emergency.catching_up")}</p>` : nothing}
    ${this.heldWaiting ? html`<p role="status">${t("handover.emergency.held_waiting")}</p>` : nothing}
    ${this.following && held ? html`<p>${t("handover.emergency.still_catching_up")}</p>` : nothing}
    ${held ? html`<section data-test="held-copy">${held.copy.source === "mirror-copy" ? this.#joinedLine(held) : nothing}${this.#activityLine(held.copy.lastChangeAtMs)}</section>` : nothing}`;
  }
  #emergencyContent() {
    const preview = this.copyPreview;
    if (!preview) return nothing;
    const about = html`${preview.copy.source === "mirror-copy" ? this.#joinedLine(preview) : nothing}
      ${this.#activityLine(preview.copy.lastChangeAtMs)}
      <p><a href=${preview.sourceServersUrl}>${t("handover.emergency.servers")}</a></p>`;
    return html`<section data-test="emergency-copy" data-wording-version="a1018-emergency-v1">
      <h2>
        ${t(preview.copy.source === "selected-backup" ? "handover.emergency.selected_backup" : preview.copy.source === "followed-copy" && !this.heldChosen ? "handover.emergency.followed" : "handover.emergency.copy")}
      </h2>
      ${
        this.#declared
          ? html`<p>${t("handover.emergency.saved")}</p>
              <details data-test="emergency-details">
                <summary>${t("handover.emergency.details")}</summary>
                ${about}
                <p>${this.reason}</p>
                ${preview.operation?.declaredAtMs ? html`<p>${t("handover.emergency.declared_at")} ${new Date(preview.operation.declaredAtMs).toLocaleString(currentLocale())}</p>` : nothing}
              </details>`
          : html`${about}
              ${preview.operation ? html`<p><a href=${`/handover/${encodeURIComponent(preview.operation.operationId)}`}>${t("handover.emergency.controlled_link")}</a></p>` : nothing}
              <p>${t("handover.emergency.warning")}</p>
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
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
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
            this.copyPreview = this.heldCopy = undefined;
            this.heldOffered = this.following = this.heldWaiting = this.heldChosen = false;
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
    const passkey = this.usePasskey;
    const signIn = html`<p>
        ${t(passkey ? "handover.emergency.sign_in_passkey" : this.#isEmergency ? "handover.emergency.sign_in" : "handover.sign_in")}
      </p>
      ${
        this.#isEmergency
          ? html`<wt-segmented-control
              name="handover-sign-in-method"
              label=${t("handover.emergency.sign_in_with")}
              .value=${passkey ? "passkey" : "password"}
              .options=${[
                { value: "password", label: t("handover.emergency.use_password") },
                { value: "passkey", label: t("handover.emergency.use_passkey") },
              ]}
              ?disabled=${this.busy}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                this.usePasskey = event.detail.value === "passkey";
                this.#assertion = undefined;
                this.actionError = "";
              }}
            ></wt-segmented-control>`
          : nothing
      }
      ${passkey ? nothing : html`${field("email", "handover.email")}${field("password", "handover.password")}${field("code", "handover.code")}`}
      ${
        this.#isEmergency && !this.#declared && !this.copyPreview?.operation
          ? html`
              <p>${t("handover.emergency.backup_intro")}</p>
              <wt-file-input
                name="handover-backup"
                label=${t("handover.emergency.backup_file")}
                .files=${this.backup ? [this.backup] : []}
                .copy=${fileInputCopy()}
                .locale=${currentLocale()}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ files: File[] }>) => {
                  event.stopPropagation();
                  this.backup = event.detail.files[0];
                  this.actionError = "";
                }}
              ></wt-file-input>
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
      }`;
    return html`${
        this.#signInShown
          ? signIn
          : this.#declared
            ? nothing
            : html`<p>
                <wt-button
                  variant="ghost"
                  data-test="different-copy"
                  ?disabled=${this.busy}
                  @click=${() => {
                    this.signInOpen = true;
                  }}
                  >${t("handover.emergency.different_copy")}</wt-button
                >
              </p>`
      }
      ${this.#isEmergency ? html`${this.#followContent()}${this.#emergencyContent()}` : nothing}
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
            ? html`${
                  this.heldOffered && this.heldCopy
                    ? html`<wt-button
                        data-test="emergency-held"
                        .disabled=${this.busy || !this.#valid()}
                        variant=${this.#valid() ? "primary" : "secondary"}
                        @click=${() => void this.#useHeldCopy()}
                        >${t("handover.emergency.use_held")}</wt-button
                      >`
                    : nothing
                }<wt-button
                  data-test="emergency-preview"
                  .disabled=${this.busy || this.following || this.heldWaiting || !this.#valid()}
                  variant=${this.#valid() && !this.following && !this.heldWaiting && !this.heldOffered ? "primary" : "secondary"}
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
      ${this.#isEmergency ? html`<p>${this.refusalLink ? html`<a href=${this.refusalLink}>${t("handover.emergency.progress")}</a>` : nothing} ${this.#leaveLink()}</p>` : nothing}`;
  }
  #content() {
    const status = this.status;
    if (activated(status))
      return html`<p role="status">${t("handover.done")}</p>
        <a href=${this.#leaveHref}>${t("handover.continue")}</a>`;
    if (closed(status)) return html`<p role="status">${t("handover.closed")}</p>`;
    if (this.restarting)
      return html`<p role="status">
        ${t(this.backupRestarting ? "handover.emergency.backup_restarting" : this.followRestarting ? "handover.emergency.followed_restarting" : "handover.restarting")}
      </p>`;
    if (this.mainCheck !== "clear") return this.#mainCheckContent(this.mainCheck);
    if (
      this.#isEmergency ||
      (status?.role === "destination" && status.copyPlaced && status.scenario === "controlled")
    )
      return this.#fields();
    return html`<p role="status">${t(status ? "handover.copy" : "handover.loading")}</p>`;
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
      ${this.#content()}
      ${status?.waitingReason ? html`<p role="status">${t(status.waitingReason === "storage.disk_full" || status.waitingReason === "handover.no_room_to_place" ? "handover.space" : status.waitingReason === "handover.source_unreachable" ? "handover.source" : status.waitingReason === "handover.copy_check_failed" ? "handover.check_failed" : "handover.wait")}</p>` : nothing}
      ${status?.waitingReason === "handover.copy_check_failed" ? html`<p><a href=${`/help/${currentLocale().startsWith("es") ? "es" : "en"}/servers#emergency`}>${t("handover.check_help")}</a></p>` : nothing}
      ${this.readFailed && !this.restarting ? html`<p role="status">${t("handover.read_failed")}</p>` : nothing}
    </main>`;
  }
}
