import { SETUP_MODULES } from "@waitron/dashboard-modules/setup";
import type {
  ModuleRecoveryKeyEntry,
  ModuleRecoveryPreparationRequest,
} from "@waitron/module/src/setup-contract.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, focusFirstInvalid, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { SetupApi, type ApiError, type CloudRecoveryView } from "../api/client.js";
import type {
  BackupRepairSession,
  BackupRepairStatus,
  FirstSetupInspection,
} from "../api/first-setup-types.js";
import { FirstSetupBackupSession, keepLease } from "../first-setup-backup-session.js";
import { SetupRecoveryAllocation } from "./recovery-allocation.js";
import { backupRepairStrings } from "../i18n/backup-repair.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { currentLocale } from "../i18n/t.js";
import { dispatchSetupGoto } from "../events.js";
import { fieldStyles, errorStyles } from "../form-styles.js";

type Source = "archive" | "bucket" | "cloud";
// One per page load: the box keeps a Cloud wait running while any of its holders renews.
const cloudHolder = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
  byte.toString(16).padStart(2, "0"),
).join("");
const STOPPABLE_PHASES: readonly string[] = ["prepared", "placement-started", "restored"];
interface Draft {
  source: Source;
  environment: "production" | "preproduction";
  artifact?: File;
  archiveKey: string;
  kit: string;
  module: string;
  secret: string;
  offline: boolean;
  sole: boolean;
}
const empty = (): Draft => ({
  source: "archive",
  environment: "production",
  archiveKey: "",
  kit: "",
  module: SETUP_MODULES[0]?.module ?? "",
  secret: "",
  offline: false,
  sole: false,
});

function shownAt(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" });
}

@customElement("setup-first-backup")
export class FirstSetupBackupScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    errorStyles,
    css`
      :host {
        display: block;
        overflow-wrap: anywhere;
      }
      label {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-3);
      }
      input[type="file"] {
        max-width: 100%;
        min-height: var(--wt-tap-min);
        font: inherit;
        color: var(--wt-color-text);
      }
      .review {
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-4);
        margin-block: var(--wt-space-4);
      }
      a {
        color: var(--wt-color-primary-text);
        overflow-wrap: anywhere;
        min-height: var(--wt-tap-min);
        display: inline-flex;
        align-items: center;
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      dt {
        color: var(--wt-color-text-muted);
      }
    `,
  ];
  @property({ attribute: false }) api = new SetupApi();
  @property({ attribute: false }) inspection?: FirstSetupInspection;
  @state() private draft = empty();
  @state() private busy = false;
  @state() private attempted = false;
  @state() private resumed = false;
  @state() private allocationInvalid = false;
  @state() private restarting = false;
  @state() private status?: BackupRepairStatus;
  @state() private authenticated?: BackupRepairSession;
  @state() private error?: { message: string; field?: string };
  @state() private cloud?: CloudRecoveryView;
  @state() private ended?: { kind: "stopped" } | { kind: "discarded"; at: string };
  #generation = 0;
  #observation?: Pick<FirstSetupInspection, "inspectionId" | "revision" | "ownerGeneration">;
  #scope?: DraftScope<Draft>;
  #session?: FirstSetupBackupSession;
  #closing: Promise<void> = Promise.resolve();
  #picker?: ModuleRecoveryKeyEntry;
  #pickerSignature?: string;
  #provenSecret?: string;
  #selectedInput?: unknown;
  #stopCloudLease?: () => void;
  #cloudHeld = false;
  #prepare = async (request: ModuleRecoveryPreparationRequest): Promise<unknown> => {
    const session = this.#session;
    if (
      !session ||
      !this.authenticated ||
      Object.keys(request.binding).length !== Object.keys(this.authenticated.binding).length ||
      Object.entries(request.binding).some(
        ([key, value]) =>
          this.authenticated!.binding[
            key as keyof NonNullable<typeof this.authenticated>["binding"]
          ] !== value,
      )
    )
      throw { code: "setup.attempt_conflict" };
    if (request.nodeRecoverySecret !== this.#provenSecret)
      throw { code: "promotion.break_glass_invalid" };
    return session.prepare(request.proposal);
  };
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  get #words() {
    return backupRepairStrings[currentLocale().startsWith("es") ? "es" : "en"];
  }
  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = draftScopeFor(this, {
      id: this,
      current: () => this.draft,
      snapshot: (draft) => ({ ...draft }),
      equal: (a, b) =>
        Object.keys({ ...a, ...b }).every((key) => a[key as keyof Draft] === b[key as keyof Draft]),
      restore: (value) => {
        this.#clearAuthority();
        this.draft = { ...value };
        this.#picker?.clear();
      },
    }).scope;
    this.#scope.commit(empty());
    void this.#readStatus();
  }
  override disconnectedCallback(): void {
    this.#letGoOfCloud();
    this.#clearAuthority();
    this.draft = empty();
    this.status = undefined;
    this.cloud = undefined;
    this.#picker?.clear();
    this.#picker = undefined;
    this.#pickerSignature = undefined;
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (
      (changed.has("api") && changed.get("api") !== undefined) ||
      (changed.has("inspection") && changed.get("inspection") !== undefined)
    ) {
      this.#clearAuthority();
      this.draft = empty();
      this.#picker?.clear();
      void this.#readStatus();
    }
  }
  #clearAuthority(): void {
    const picker = this.shadowRoot?.querySelector<HTMLInputElement>("[data-test=artifact]");
    if (picker) picker.value = "";
    ++this.#generation;
    const session = this.#session;
    this.#session = undefined;
    this.authenticated = undefined;
    this.#provenSecret = undefined;
    this.#selectedInput = undefined;
    this.busy = false;
    this.resumed = false;
    this.allocationInvalid = false;
    if (session)
      this.#closing = Promise.all([this.#closing, session.dispose()])
        .then(() => {})
        .catch(() => {});
  }
  #letGoOfCloud(): void {
    this.#endCloudLease();
    if (this.#cloudHeld) void this.api.releaseFirstSetupBackupCloud(cloudHolder).catch(() => {});
    this.#cloudHeld = false;
  }
  #endCloudLease(): void {
    this.#stopCloudLease?.();
    this.#stopCloudLease = undefined;
  }
  #holdCloudLease(): void {
    this.#cloudHeld = true;
    this.#stopCloudLease ??= keepLease(
      () => this.api.renewFirstSetupBackupCloud(cloudHolder),
      (cause) => {
        this.#stopCloudLease = undefined;
        // A lapsed wait keeps Check: once Cloud approves, opening starts a new session.
        if (cause.code === "setup.recovery_discarded") this.#endRecovery(cause);
      },
    );
  }
  #endRecovery(cause: ApiError): void {
    this.#endCloudLease();
    this.#clearAuthority();
    const at = cause.params?.discardedAt;
    this.ended =
      cause.code === "setup.recovery_discarded" && typeof at === "string"
        ? { kind: "discarded", at }
        : { kind: "stopped" };
  }
  async #readStatus(): Promise<void> {
    this.#clearAuthority();
    const generation = this.#generation;
    this.ended = undefined;
    this.busy = true;
    this.status = undefined;
    this.#observation = undefined;
    this.error = undefined;
    this.attempted = false;
    this.draft = {
      ...this.draft,
      artifact: undefined,
      archiveKey: "",
      kit: "",
      secret: "",
      offline: false,
      sole: false,
    };
    this.#picker?.clear();
    try {
      await this.#closing;
      if (!this.isConnected || generation !== this.#generation) return;
      const [status, inspection] = await Promise.all([
        this.api.firstSetupBackupStatus(),
        this.api.inspectFirstSetupResolution(),
      ]);
      if (!this.isConnected || generation !== this.#generation) return;
      if (
        !status ||
        status.proofRequired !== true ||
        ![
          "unstarted",
          "prepared",
          "placement-started",
          "restored",
          "selected",
          "uncertain",
        ].includes(status.phase)
      )
        throw { code: "setup.attempt_invalid" };
      if (
        typeof inspection?.inspectionId !== "string" ||
        !inspection.inspectionId ||
        ![inspection.revision, inspection.ownerGeneration].every(
          (value) => value === null || (Number.isSafeInteger(value) && value! > 0),
        )
      )
        throw { code: "setup.attempt_invalid" };
      const activity =
        status.recoveryId !== undefined && STOPPABLE_PHASES.includes(status.phase)
          ? (await this.api.firstSetupBackupActivity())?.activity
          : null;
      if (activity !== null && typeof activity?.state !== "string")
        throw { code: "setup.attempt_invalid" };
      if (!this.isConnected || generation !== this.#generation) return;
      this.#observation = {
        inspectionId: inspection.inspectionId,
        revision: inspection.revision,
        ownerGeneration: inspection.ownerGeneration,
      };
      this.status = status;
      if (activity?.state === "stopped" && activity.recoveryId === status.recoveryId)
        this.ended = { kind: "stopped" };
    } catch {
      if (this.isConnected && generation === this.#generation)
        this.error = { message: this.#words.statusFailed };
    } finally {
      if (this.isConnected && generation === this.#generation) this.busy = false;
    }
  }
  #edit<K extends keyof Draft>(field: K, value: Draft[K]): void {
    if (this.busy || this.restarting) return;
    if (["source", "environment", "module"].includes(field)) {
      const authenticated = this.#session !== undefined;
      this.#clearAuthority();
      this.draft = {
        ...empty(),
        source: this.draft.source,
        environment: this.draft.environment,
        module: this.draft.module,
        [field]: value,
      };
      this.#picker?.clear();
      this.cloud = undefined;
      if (field === "source" && value !== "cloud") this.#letGoOfCloud();
      this.attempted = false;
      if (authenticated) void this.#readStatus();
    } else this.draft = { ...this.draft, [field]: value };
    this.error = undefined;
    this.#scope?.changed();
  }
  #invalid(field: string): boolean {
    if (field === "secret") return !this.draft.secret;
    if (field === "offline") return !this.draft.offline;
    if (field === "sole") return !this.draft.sole;
    if (this.resumed) return false;
    if (field === "artifact") return this.draft.source === "archive" && !this.draft.artifact?.size;
    if (field === "archiveKey")
      return this.draft.source === "archive" && !this.draft.archiveKey.trim();
    if (field === "kit") return this.draft.source === "bucket" && !this.draft.kit.trim();
    if (field === "pointId")
      return (
        this.draft.source === "cloud" && (this.cloud?.state !== "approved" || !this.cloud.point)
      );
    return false;
  }
  get #invalidDraft(): boolean {
    return ["secret", "offline", "sole", "artifact", "archiveKey", "kit", "pointId"].some((field) =>
      this.#invalid(field),
    );
  }
  #fieldError(field: string): string {
    if (this.attempted && this.#invalid(field))
      return field === "secret"
        ? this.#words.keyRequired
        : ["offline", "sole"].includes(field)
          ? this.#words.confirm
          : this.#words.required;
    return this.error?.field === field ? this.error.message : "";
  }
  #refusal(cause: unknown): void {
    const error = cause as ApiError | undefined;
    const code = error?.code;
    const field = error?.params?.field;
    const named =
      typeof field === "string"
        ? (({ nodeRecoverySecret: "secret", recoveryKey: "archiveKey" } as Record<string, string>)[
            field
          ] ?? field)
        : undefined;
    const shown =
      named !== undefined &&
      [
        "secret",
        "environment",
        ...(this.draft.source === "archive"
          ? ["artifact", "archiveKey"]
          : this.draft.source === "bucket"
            ? ["kit"]
            : ["pointId"]),
      ].includes(named);
    this.error =
      code === "promotion.break_glass_invalid"
        ? { message: this.#words.keyRefused, field: "secret" }
        : (code === "backup.artifact_invalid" ||
              code === "backup.archive_invalid" ||
              code === "recovery.passphrase_invalid") &&
            this.draft.source === "archive"
          ? { message: this.#words.archiveRefused, field: "archiveKey" }
          : code === "setup.attempt_conflict" || code === "setup.owner_required"
            ? { message: this.#words.conflict }
            : shown
              ? { message: this.#words.required, field: named }
              : { message: this.#words.failed };
  }
  #keyPicker(): ModuleRecoveryKeyEntry | undefined {
    const signature = JSON.stringify([this.draft.module, this.draft.environment]);
    if (signature !== this.#pickerSignature) {
      this.#picker?.clear();
      this.#pickerSignature = signature;
      this.#picker = SETUP_MODULES.find(
        (module) => module.module === this.draft.module,
      )?.createRecoveryKey?.({
        locale: currentLocale().startsWith("es") ? "es" : "en",
      });
      this.#picker?.setAttribute("data-test", "proof-key");
    }
    if (this.#picker) {
      this.#picker.locale = currentLocale().startsWith("es") ? "es" : "en";
      this.#picker.errorMessage = this.#fieldError("secret");
    }
    return this.#picker;
  }
  async #open(resume = false): Promise<void> {
    if (this.busy || this.restarting || this.authenticated || !this.status || !this.#observation)
      return;
    this.resumed = resume;
    this.attempted = true;
    this.error = undefined;
    if (this.#invalidDraft || !this.#picker) {
      await this.updateComplete;
      focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const generation = ++this.#generation;
    this.busy = true;
    const session = new FirstSetupBackupSession(this.api, {
      onRenewalRefused: (cause) => {
        if (this.isConnected && this.#session === session) this.#endRecovery(cause);
      },
    });
    this.#session = session;
    const { inspectionId, revision, ownerGeneration } = this.#observation;
    const proof = {
      observation: { inspectionId, revision, ownerGeneration },
      nodeRecoverySecret: this.draft.secret,
      context: { oldBoxGone: this.draft.offline, soleRecovery: this.draft.sole },
    };
    try {
      await this.#closing;
      if (!this.isConnected || generation !== this.#generation) return;
      const result = resume
        ? await session.resume({ ...proof, recoveryId: this.status.recoveryId! })
        : await session.open({
            ...proof,
            source:
              this.draft.source === "archive"
                ? {
                    kind: "archive",
                    artifact: this.draft.artifact!,
                    recoveryKey: this.draft.archiveKey,
                    environment: this.draft.environment,
                  }
                : this.draft.source === "bucket"
                  ? { kind: "bucket", kit: this.draft.kit, environment: this.draft.environment }
                  : { kind: "cloud", pointId: this.cloud!.point!.id },
            ...(this.status.recoveryId ? { recoveryId: this.status.recoveryId } : {}),
          });
      if (!this.isConnected || generation !== this.#generation) return;
      // Opening hands the Cloud wait's lease to the session, which renews it from here.
      this.#endCloudLease();
      this.authenticated = result;
      this.#provenSecret = proof.nodeRecoverySecret;
      this.#selectedInput = resume ? result.input : undefined;
      this.draft = { ...this.draft, secret: "", archiveKey: "", kit: "", artifact: undefined };
      this.#picker.clear();
      this.attempted = false;
      this.#scope?.commit(this.draft);
    } catch (cause) {
      if (this.isConnected && generation === this.#generation) {
        this.#session = undefined;
        if ((cause as ApiError | undefined)?.code === "setup.recovery_discarded")
          this.#endRecovery(cause as ApiError);
        else this.#refusal(cause);
      }
      await session.dispose().catch(() => {});
    } finally {
      if (this.isConnected && generation === this.#generation) this.busy = false;
    }
  }
  async #commit(): Promise<void> {
    if (this.busy || !this.authenticated || !this.#session) return;
    if (!this.resumed) {
      const credentials = this.shadowRoot!.querySelector<SetupRecoveryAllocation>(
        "setup-recovery-allocation",
      )?.readCredentials();
      if (!credentials) {
        this.error = { message: this.#words.fix };
        return;
      }
      this.#selectedInput = credentials.recoveryOperation.input;
    }
    const generation = this.#generation;
    this.busy = true;
    this.error = undefined;
    try {
      await this.#session.commit(this.#selectedInput);
      if (this.isConnected && generation === this.#generation) {
        this.#scope?.commit(this.draft);
        this.#clearAuthority();
        this.restarting = true;
      }
    } catch (cause) {
      if (this.isConnected && generation === this.#generation)
        if ((cause as ApiError | undefined)?.code === "setup.recovery_discarded")
          this.#endRecovery(cause as ApiError);
        else this.#refusal(cause);
    } finally {
      if (this.isConnected && generation === this.#generation) this.busy = false;
    }
  }
  async #cloudAction(action: "start" | "status" | "again"): Promise<void> {
    if (this.busy) return;
    const generation = ++this.#generation;
    this.busy = true;
    this.error = undefined;
    this.cloud = undefined;
    try {
      const view = await (action === "start"
        ? this.api.startFirstSetupBackupCloud(cloudHolder)
        : action === "status"
          ? this.api.firstSetupBackupCloudStatus(cloudHolder)
          : this.api.startFirstSetupBackupCloudAgain(cloudHolder));
      if (
        view === null ||
        typeof view !== "object" ||
        typeof view.openCloudUrl !== "string" ||
        typeof view.code !== "string" ||
        !["awaiting_owner", "approved", "expired"].includes(view.state) ||
        (view.state === "approved" &&
          (typeof view.point?.id !== "string" ||
            !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(view.point.id)))
      )
        throw { code: "setup.attempt_invalid" };
      if (this.isConnected && generation === this.#generation) {
        this.cloud = view;
        this.#holdCloudLease();
      }
    } catch {
      if (this.isConnected && generation === this.#generation)
        this.error = { message: this.#words.cloudUnavailable };
    } finally {
      if (this.isConnected && generation === this.#generation) this.busy = false;
    }
  }
  override render() {
    const s = this.#words;
    if (this.restarting || this.status?.phase === "selected")
      return html`<section data-test="screen-first-backup">
        <h1>${s.heading}</h1>
        <p data-test="restarting" role="status">${s.restarting}</p>
        <wt-button data-test="reconnect" @click=${() => dispatchSetupGoto(this, "first-owner")}
          >${s.reconnect}</wt-button
        >
      </section>`;
    if (this.ended) {
      const discarded =
        this.ended.kind === "discarded" ? s.discarded.replace("{at}", shownAt(this.ended.at)) : "";
      return html`<section data-test="screen-first-backup">
        <h1>${s.heading}</h1>
        ${
          this.ended.kind === "stopped"
            ? html`<p data-test="stopped" role="status">${s.stopped}</p>
                <wt-button data-test="back" @click=${() => dispatchSetupGoto(this, "first-owner")}
                  >${s.back}</wt-button
                >`
            : html`<p data-test="discarded" role="status">${discarded}</p>
                <wt-button
                  data-test="reload-status"
                  ?disabled=${this.busy}
                  @click=${() => void this.#readStatus()}
                  >${s.reconnect}</wt-button
                >`
        }
      </section>`;
    }
    const disabled = this.busy || !this.status || (this.attempted && this.#invalidDraft);
    return html`<section
      data-test="screen-first-backup"
      @keydown=${(event: KeyboardEvent) => {
        const target = event.composedPath()[0];
        if (
          event.key === "Enter" &&
          target instanceof HTMLInputElement &&
          target.type !== "file" &&
          target.type !== "checkbox"
        ) {
          event.preventDefault();
          if (this.authenticated) void this.#commit();
          else void this.#open(this.resumed);
        }
      }}
    >
      <h1>${s.heading}</h1>
      <p>${s.retained}</p>
      <p data-test="handoff-restart">${s.handoffRestart}</p>
      <wt-combobox
        class="field"
        data-test="source"
        name="backup-source"
        label=${s.source}
        required
        .value=${this.draft.source}
        ?disabled=${this.busy}
        .options=${[
          { value: "archive", label: s.archive },
          { value: "bucket", label: s.bucket },
          { value: "cloud", label: s.cloud },
        ]}
        @wt-change=${(event: CustomEvent<{ value: Source }>) => {
          event.stopPropagation();
          this.#edit("source", event.detail.value);
        }}
      ></wt-combobox>
      <wt-combobox
        class="field"
        data-test="environment"
        name="backup-environment"
        label=${s.environment}
        .error=${this.#fieldError("environment")}
        required
        .value=${this.draft.environment}
        ?disabled=${this.busy}
        .options=${[
          { value: "production", label: s.production },
          { value: "preproduction", label: s.preproduction },
        ]}
        @wt-change=${(event: CustomEvent<{ value: Draft["environment"] }>) => {
          event.stopPropagation();
          this.#edit("environment", event.detail.value);
        }}
      ></wt-combobox>
      ${
        this.authenticated
          ? html`<section class="review" data-test="review" aria-labelledby="backup-review-heading">
                <h2 id="backup-review-heading">${s.review}</h2>
                <dl>
                  <dt>${s.taxId}</dt>
                  <dd>${this.authenticated.preview.taxpayer.taxId}</dd>
                  <dd>${this.authenticated.preview.taxpayer.legalName}</dd>
                  <dd>${this.authenticated.preview.locationName}</dd>
                  <dt>${s.keyName}</dt>
                  <dd>${this.authenticated.preview.nodeRecoveryKeyName}</dd>
                  <dd>${this.authenticated.preview.createdAt}</dd>
                </dl>
              </section>
              ${
                this.resumed
                  ? nothing
                  : html`<setup-recovery-allocation
                      data-test="allocation"
                      .preview=${this.authenticated.preview}
                      .binding=${this.authenticated.binding}
                      .prepare=${this.#prepare}
                      @recovery-invalid=${(event: CustomEvent<{ invalid: boolean }>) => {
                        event.stopPropagation();
                        this.allocationInvalid = event.detail.invalid;
                        if (!event.detail.invalid) this.error = undefined;
                      }}
                    ></setup-recovery-allocation>`
              }
              <wt-form-actions .error=${this.error?.message ?? ""}
                ><wt-button
                  slot="cancel"
                  variant="secondary"
                  ?disabled=${this.busy}
                  @click=${() => {
                    this.#clearAuthority();
                    this.draft = empty();
                    this.#picker?.clear();
                    this.#scope?.commit(this.draft);
                    void this.#readStatus();
                  }}
                  >${s.back}</wt-button
                ><wt-button
                  data-test="commit"
                  variant=${this.allocationInvalid && !this.busy ? "secondary" : "primary"}
                  ?disabled=${this.busy || this.allocationInvalid}
                  @click=${() => void this.#commit()}
                  >${s.commit}</wt-button
                ></wt-form-actions
              >`
          : html`${
                this.draft.source === "archive"
                  ? html`<label for="repair-artifact">${s.artifact} *</label
                      ><input
                        id="repair-artifact"
                        data-test="artifact"
                        name="repair-backup-file"
                        type="file"
                        accept=".waitron,application/octet-stream"
                        ?disabled=${this.busy}
                        aria-invalid=${this.#fieldError("artifact") ? "true" : "false"}
                        aria-describedby="repair-artifact-error"
                        @change=${(event: Event) => this.#edit("artifact", (event.currentTarget as HTMLInputElement).files?.[0])}
                      />
                      <p id="repair-artifact-error" data-test="artifact-error" class="error">
                        ${this.#fieldError("artifact")}
                      </p>
                      <wt-input
                        class="field"
                        name="archive-key"
                        data-test="archive-key"
                        label=${s.archiveKey}
                        type="password"
                        autocomplete="off"
                        required
                        ?disabled=${this.busy}
                        .value=${this.draft.archiveKey}
                        .error=${this.#fieldError("archiveKey")}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          this.#edit("archiveKey", event.detail.value);
                        }}
                      ></wt-input>`
                  : this.draft.source === "bucket"
                    ? html`<wt-textarea
                        class="field"
                        data-test="kit"
                        name="bucket-recovery-kit"
                        label=${s.kit}
                        required
                        .value=${this.draft.kit}
                        ?disabled=${this.busy}
                        .error=${this.#fieldError("kit")}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          this.#edit("kit", event.detail.value);
                        }}
                      ></wt-textarea>`
                    : html`<wt-button
                          data-test="cloud-start"
                          ?disabled=${this.busy}
                          @click=${() => void this.#cloudAction("start")}
                          >${s.cloudStart}</wt-button
                        ><wt-button
                          data-test="cloud-check"
                          variant="secondary"
                          ?disabled=${this.busy}
                          @click=${() => void this.#cloudAction("status")}
                          >${s.cloudCheck}</wt-button
                        ><wt-button
                          data-test="cloud-again"
                          variant="secondary"
                          ?disabled=${this.busy}
                          @click=${() => void this.#cloudAction("again")}
                          >${s.cloudAgain}</wt-button
                        >${
                          this.cloud?.openCloudUrl?.startsWith("https://")
                            ? html`<p>
                                  <a
                                    href=${this.cloud.openCloudUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    >${s.cloudLink}</a
                                  >
                                </p>
                                <p>${this.cloud.code}</p>`
                            : nothing
                        }
                        <p class="error">${this.#fieldError("pointId")}</p>`
              }

              <div
                @recovery-key-change=${(event: CustomEvent<{ secret?: string }>) => {
                  event.stopPropagation();
                  const secret = event.detail.secret ?? "";
                  if (secret === this.draft.secret && !this.error) return;
                  this.draft = { ...this.draft, secret };
                  this.error = undefined;
                  this.#scope?.changed();
                }}
              >
                ${this.#keyPicker() ?? html`<p>${s.missingModule}</p>`}
              </div>
              ${(["offline", "sole"] as const).map(
                (name) =>
                  html`<label
                      ><input
                        data-test=${name}
                        name=${`repair-${name}`}
                        type="checkbox"
                        .checked=${this.draft[name]}
                        ?disabled=${this.busy}
                        aria-invalid=${this.#fieldError(name) ? "true" : "false"}
                        aria-describedby=${`repair-${name}-error`}
                        @change=${(event: Event) => this.#edit(name, (event.currentTarget as HTMLInputElement).checked)}
                      />${s[name]} *</label
                    >
                    <p id=${`repair-${name}-error`} data-test=${`${name}-error`} class="error">
                      ${this.#fieldError(name)}
                    </p>`,
              )}
              <wt-form-actions
                .error=${(this.attempted && this.#invalidDraft) || this.error?.field ? s.fix : (this.error?.message ?? "")}
                ><wt-button
                  data-test="back"
                  slot="cancel"
                  variant="secondary"
                  ?disabled=${this.busy}
                  @click=${() => dispatchSetupGoto(this, "first-owner")}
                  >${s.back}</wt-button
                ><wt-button
                  data-test="prove"
                  variant=${disabled && !this.busy ? "secondary" : "primary"}
                  ?disabled=${disabled}
                  @click=${() => void this.#open()}
                  >${s.prove}</wt-button
                ></wt-form-actions
              >
              ${this.status?.recoveryId && ["placement-started", "restored"].includes(this.status.phase) ? html`<wt-button data-test="resume" ?disabled=${this.busy || (this.attempted && ["secret", "offline", "sole"].some((field) => this.#invalid(field)))} @click=${() => void this.#open(true)}>${s.resume}</wt-button>` : nothing}
              ${(!this.status || this.error) && !this.busy ? html`<wt-button data-test="reload-status" @click=${() => void this.#readStatus()}>${s.reconnect}</wt-button>` : nothing}`
      }
      ${this.busy ? html`<p role="status">${s.waiting}</p>` : nothing}
    </section>`;
  }
}
