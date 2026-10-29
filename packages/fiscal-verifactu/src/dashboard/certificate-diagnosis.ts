import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { subscribeLocale, type DashboardPermissionContinuation } from "@waitron/dashboard-kit";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-file-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  copyCertificateDiagnosis,
  type CertificateDiagnosisResult,
} from "../certificate-diagnosis-contract.js";
import type { AeatCertificateClient, CertificateCardView, CertificateKind } from "./client.js";
import {
  DiagnosisState,
  rememberDiagnosisReturn,
  clearDiagnosisReturn,
  type DiagnosisCandidate,
} from "./certificate-diagnosis-state.js";
import { t, type AeatCertificateKey } from "./strings.js";

@customElement("dashboard-aeat-certificate-diagnosis")
export class AeatCertificateDiagnosis extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body,
      section {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      h3,
      p,
      dl,
      dd {
        margin: 0;
      }
      h3 {
        font-size: var(--wt-font-size-md);
      }
      dl {
        display: grid;
        gap: var(--wt-space-2);
      }
      dt {
        color: var(--wt-color-text-muted);
      }
      dd {
        overflow-wrap: anywhere;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
    `,
  ];
  @property({ attribute: false }) client!: AeatCertificateClient;
  @property({ attribute: false }) savedCard!: CertificateCardView;
  @property({ attribute: false }) permissionContinuation?: DashboardPermissionContinuation;
  @property({ attribute: false }) candidate: DiagnosisCandidate | null = null;
  @property() source: "installed" | "candidate" = "installed";
  @property({ attribute: false }) readOnly = false;
  @state() private copied = "";
  #controller?: DiagnosisState;
  #unsubscribe?: () => void;
  #locale?: () => void;
  #login?: AbortController;
  #sourceGeneration = 0;
  #file: File | null = null;
  #passphrase = "";
  #kind: CertificateKind = "sello";
  override connectedCallback(): void {
    super.connectedCallback();
    this.#file = this.candidate?.file ?? null;
    this.#passphrase = this.candidate?.passphrase ?? "";
    this.#kind = this.candidate?.certKind ?? "sello";
    this.#controller = new DiagnosisState({
      client: this.client,
      permissionContinuation: this.permissionContinuation,
      changed: () => {
        this.copied = "";
        this.requestUpdate();
      },
      canManage: () => !this.readOnly,
    });
    this.#open();
    let account = this.permissionContinuation?.snapshot().accountGeneration;
    this.#unsubscribe = this.permissionContinuation?.subscribe((snapshot) => {
      if (snapshot.accountGeneration === account) return;
      account = snapshot.accountGeneration;
      this.#discard();
      this.requestUpdate();
    });
    this.#locale = subscribeLocale(() => this.requestUpdate());
  }
  override disconnectedCallback(): void {
    this.#controller?.stop();
    this.#discard();
    this.#unsubscribe?.();
    this.#locale?.();
    super.disconnectedCallback();
  }
  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("candidate") || changed.has("source") || changed.has("savedCard")) this.#open();
  }
  #open(): void {
    this.#controller?.open({
      source: this.source,
      savedCard: this.savedCard,
      candidate: this.candidate,
    });
  }
  #discard(): void {
    this.candidate = null;
    this.#file = null;
    this.#passphrase = "";
    this.#sourceGeneration++;
    this.copied = "";
  }
  #edit(): void {
    this.#controller?.invalidateSource();
    this.#sourceGeneration++;
    this.candidate = this.#file
      ? {
          file: this.#file,
          passphrase: this.#passphrase,
          certKind: this.#kind,
          sourceGeneration: this.#sourceGeneration,
        }
      : null;
    this.#open();
  }
  async #signIn(): Promise<void> {
    if (!this.permissionContinuation || this.#login) return;
    this.#controller?.invalidateAccount();
    this.#discard();
    this.#login = new AbortController();
    rememberDiagnosisReturn(this.permissionContinuation, this.source);
    try {
      const outcome = await this.permissionContinuation.signIn({
        permission: "system.manage",
        signal: this.#login.signal,
      });
      if (outcome === "stopped") clearDiagnosisReturn(this.permissionContinuation);
    } catch {
      clearDiagnosisReturn(this.permissionContinuation);
    } finally {
      this.#login = undefined;
      if (this.isConnected) this.requestUpdate();
    }
  }
  #stop(): void {
    if (this.permissionContinuation) clearDiagnosisReturn(this.permissionContinuation);
    this.#controller?.stop();
    this.#login?.abort();
    this.#discard();
  }
  #run(operation: "inspect" | "check"): void {
    void this.#controller?.run(operation);
    void this.updateComplete.then(() => {
      if (this.isConnected && this.#controller?.view.busy)
        this.shadowRoot?.querySelector<HTMLElement>("[data-test=diagnosis-stop]")?.focus();
    });
  }
  async #copy(): Promise<void> {
    const result = this.#controller?.view.result;
    if (!result) return;
    const generation = this.permissionContinuation?.snapshot().accountGeneration;
    try {
      await navigator.clipboard.writeText(copyCertificateDiagnosis(result));
      if (
        this.isConnected &&
        generation === this.permissionContinuation?.snapshot().accountGeneration &&
        result === this.#controller?.view.result
      )
        this.copied = t("aeat_certificate.diagnosis.copied");
    } catch {
      if (this.isConnected && result === this.#controller?.view.result)
        this.copied = t("aeat_certificate.diagnosis.copy_failed");
    }
  }
  #observation(result: CertificateDiagnosisResult): string {
    if (
      result.operation === "check" &&
      result.httpStatus !== null &&
      result.category !== "query-completed"
    )
      return t("aeat_certificate.diagnosis.http", { status: result.httpStatus });
    if (result.category === "query-completed")
      return t("aeat_certificate.diagnosis.query", { time: result.completedAt });
    return t(`aeat_certificate.diagnosis.${result.category}` as AeatCertificateKey);
  }
  #candidateFields(busy: boolean): TemplateResult {
    return html`<p>${t("aeat_certificate.diagnosis.no_candidate")}</p>
      <wt-file-input
        compact
        name="diagnosis-certificate-file"
        accept=".pfx,.p12"
        required
        label=${t("aeat_certificate.dialog.file_label")}
        .files=${this.#file ? [this.#file] : []}
        .copy=${{ drop: t("aeat_certificate.dialog.file_drop"), choose: t("aeat_certificate.dialog.file_choose"), replace: t("aeat_certificate.dialog.file_replace"), previewAlt: t("aeat_certificate.dialog.file_preview") }}
        ?disabled=${busy}
        @wt-change=${(event: CustomEvent<{ files: File[] }>) => {
          event.stopPropagation();
          this.#file = event.detail.files[0] ?? null;
          this.#edit();
        }}
      ></wt-file-input>
      <wt-input
        name="diagnosis-certificate-passphrase"
        type="password"
        autocomplete="off"
        required
        label=${t("aeat_certificate.dialog.passphrase_label")}
        .value=${this.#passphrase}
        ?disabled=${busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.#passphrase = event.detail.value;
          this.#edit();
        }}
      ></wt-input>
      <wt-combobox
        name="diagnosis-certificate-kind"
        search="never"
        required
        label=${t("aeat_certificate.dialog.kind_label")}
        .value=${this.#kind}
        .options=${(["sello", "representante"] as const).map((value) => ({ value, label: t(`aeat_certificate.kind.${value}`) }))}
        ?disabled=${busy}
        @wt-change=${(event: CustomEvent<{ value: CertificateKind }>) => {
          event.stopPropagation();
          this.#kind = event.detail.value;
          this.#edit();
        }}
      ></wt-combobox>`;
  }
  override render(): TemplateResult {
    const controller = this.#controller,
      view = controller?.view,
      result = view?.result,
      busy = view?.busy ?? false;
    const saved = result
      ? result.saved
      : this.savedCard.installed
        ? { kind: this.savedCard.installed.kind, installedAt: this.savedCard.installed.installedAt }
        : null;
    return html`<wt-dialog
      open
      heading=${t("aeat_certificate.diagnosis.title")}
      .beforeClose=${this.#beforeClose}
      @wt-close=${() => this.#stop()}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Enter") event.stopPropagation();
      }}
    >
      <div class="body">
        <p>${t("aeat_certificate.diagnosis.intro")}</p>
        ${!this.savedCard.filing ? html`<p>${t("aeat_certificate.not_filing")}</p>` : nothing}
        <wt-combobox
          name="diagnosis-source"
          search="never"
          label=${t("aeat_certificate.diagnosis.source")}
          .value=${this.source}
          .options=${(["installed", "candidate"] as const).map((value) => ({ value, label: t(`aeat_certificate.diagnosis.${value}`) }))}
          @wt-change=${(event: CustomEvent<{ value: "installed" | "candidate" }>) => {
            event.stopPropagation();
            this.#controller?.invalidateSource();
            this.source = event.detail.value;
            this.#open();
          }}
        ></wt-combobox>
        ${this.source === "candidate" ? this.#candidateFields(busy) : nothing}
        <dl>
          <dt>${t("aeat_certificate.diagnosis.saved")}</dt>
          <dd>
            ${saved ? html`${t(`aeat_certificate.kind.${saved.kind}`)} · ${saved.installedAt}` : t("aeat_certificate.diagnosis.no_saved")}
          </dd>
          ${saved ? html`<dd>${t(result?.association === "verified" ? "aeat_certificate.diagnosis.verified" : "aeat_certificate.diagnosis.unverified")}</dd>` : nothing}
          <dt>${t("aeat_certificate.diagnosis.environment")}</dt>
          <dd>
            ${result ? t(`aeat_certificate.diagnosis.${result.environment}`) : t("aeat_certificate.diagnosis.unread")}
          </dd>
          <dt>${t("aeat_certificate.diagnosis.destination")}</dt>
          <dd>${result?.endpointLabel ?? t("aeat_certificate.diagnosis.unread")}</dd>
          <dt>${t("aeat_certificate.diagnosis.kind")}</dt>
          <dd>
            ${result?.kind ? t(`aeat_certificate.kind.${result.kind}`) : t("aeat_certificate.diagnosis.unread")}
          </dd>
        </dl>
        <div role="status" aria-live="polite">
          ${busy ? t("aeat_certificate.diagnosis.busy") : view?.revisionChanged ? t("aeat_certificate.diagnosis.revision_changed") : view?.resultUnavailable ? t("aeat_certificate.diagnosis.unavailable") : nothing}
        </div>
        ${
          result
            ? html`<section aria-labelledby="diagnosis-observed">
                  <h3 id="diagnosis-observed">${t("aeat_certificate.diagnosis.observed")}</h3>
                  <p>${this.#observation(result)}</p>
                  ${result.localFinding ? html`<p>${this.#finding(result.localFinding)}</p>` : nothing}
                </section>
                <section aria-labelledby="diagnosis-cause">
                  <h3 id="diagnosis-cause">${t("aeat_certificate.diagnosis.cause")}</h3>
                  <p>${t("aeat_certificate.diagnosis.cause_unknown")}</p>
                </section>`
            : nothing
        }
        <section aria-labelledby="diagnosis-choices">
          <h3 id="diagnosis-choices">${t("aeat_certificate.diagnosis.choices")}</h3>
          <p>${t("aeat_certificate.diagnosis.repair")}</p>
          ${
            !controller?.authorized
              ? html`<p>${t("aeat_certificate.diagnosis.authority")}</p>
                  ${this.permissionContinuation ? html`<wt-button data-test="diagnosis-sign-in" variant="secondary" @click=${() => void this.#signIn()}>${t("aeat_certificate.diagnosis.sign_in")}</wt-button>` : nothing}`
              : nothing
          }
          <div class="actions">
            ${
              view?.revisionChanged
                ? html`<wt-button
                    data-test="diagnosis-reload-card"
                    variant="secondary"
                    @click=${async () => {
                      const closed =
                        await this.shadowRoot!.querySelector("wt-dialog")!.requestClose("cancel");
                      if (closed && this.isConnected)
                        this.dispatchEvent(
                          new CustomEvent("diagnosis-reload-card", {
                            bubbles: true,
                            composed: true,
                          }),
                        );
                    }}
                    >${t("aeat_certificate.diagnosis.reload_card")}</wt-button
                  >`
                : nothing
            }
            ${view?.needsSourceConfirmation ? html`<wt-button data-test="diagnosis-confirm" variant="secondary" @click=${() => controller?.confirmSource()}>${t("aeat_certificate.diagnosis.confirm")}</wt-button>` : nothing}
            <wt-button
              data-test="diagnosis-inspect"
              variant=${controller?.canInspect ? "primary" : "secondary"}
              ?disabled=${!controller?.canInspect}
              @click=${() => this.#run("inspect")}
              >${t("aeat_certificate.diagnosis.inspect")}</wt-button
            >
            <wt-button
              data-test="diagnosis-check"
              variant=${controller?.canCheck ? "primary" : "secondary"}
              ?disabled=${!controller?.canCheck}
              @click=${() => this.#run("check")}
              >${t(result?.operation === "check" ? "aeat_certificate.diagnosis.again" : "aeat_certificate.diagnosis.check")}</wt-button
            >
            ${result ? html`<wt-button data-test="diagnosis-copy" variant="secondary" @click=${() => void this.#copy()}>${t("aeat_certificate.diagnosis.copy")}</wt-button>` : nothing}
            <wt-button
              data-test="diagnosis-edit"
              variant="secondary"
              ?disabled=${!controller?.authorized || !this.savedCard.filing}
              @click=${() => {
                this.dispatchEvent(
                  new CustomEvent("diagnosis-edit", { bubbles: true, composed: true }),
                );
                void this.shadowRoot!.querySelector("wt-dialog")!.requestClose("cancel");
              }}
              >${t(this.source === "candidate" ? "aeat_certificate.diagnosis.edit" : this.savedCard.revision === null ? "aeat_certificate.install" : "aeat_certificate.replace")}</wt-button
            >
          </div>
        </section>
        <p role="status">${this.copied}</p>
      </div>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          data-test="diagnosis-stop"
          variant="secondary"
          @click=${() => void this.shadowRoot!.querySelector("wt-dialog")!.requestClose("cancel")}
          >${t("aeat_certificate.diagnosis.stop")}</wt-button
        ></wt-form-actions
      >
    </wt-dialog>`;
  }
  readonly #beforeClose = (): Promise<boolean> => {
    this.#stop();
    return Promise.resolve(true);
  };
  #finding(finding: NonNullable<CertificateDiagnosisResult["localFinding"]>): string {
    if (finding === "missing" || finding === "unusable")
      return t("aeat_certificate.diagnosis.no_candidate");
    return t(`aeat_certificate.refused.${finding}` as AeatCertificateKey);
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-aeat-certificate-diagnosis": AeatCertificateDiagnosis;
  }
}
