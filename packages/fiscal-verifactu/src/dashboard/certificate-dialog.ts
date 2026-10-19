import { LitElement, css, html, nothing, svg, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-file-input.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { codeMessage, codeOf, subscribeLocale } from "@waitron/dashboard-kit";
import type { AeatCertificateClient, CertificateKind, InstallAnswerView } from "./client.js";
import { t, type AeatCertificateKey } from "./strings.js";
import { calendarDay } from "./dates.js";
import { exportGuidesStyles, exportGuidesView } from "./export-guides-view.js";
import { CERTIFICATE_MAX_BYTES } from "../certificate-limits.js";

const KINDS: readonly CertificateKind[] = ["sello", "representante"];

/** The conflict, and the request primitive's codes for a POST whose reply was lost, which may have
 * committed. */
const VAULT_MAY_HAVE_CHANGED = new Set([
  "fiscal.certificate_changed",
  "connection.failed",
  "server.internal",
]);

type Draft = { file: File | null; passphrase: string; certKind: CertificateKind };
type Field = "file" | "passphrase";
type Refusal = { field?: Field; message: string };

const same = (a: Draft, b: Draft) =>
  a.file === b.file && a.passphrase === b.passphrase && a.certKind === b.certKind;

const REFUSAL_KEYS: Record<string, AeatCertificateKey> = {
  too_large: "aeat_certificate.refused.too_large",
  unreadable: "aeat_certificate.refused.unreadable",
  old_encryption: "aeat_certificate.refused.old_encryption",
  no_private_key: "aeat_certificate.refused.no_private_key",
  passphrase_wrong: "aeat_certificate.refused.passphrase_wrong",
  expired: "aeat_certificate.refused.expired",
  not_yet_valid: "aeat_certificate.refused.not_yet_valid",
  same: "aeat_certificate.refused.same",
  other_taxpayer: "aeat_certificate.refused.other_taxpayer",
  unreachable: "aeat_certificate.refused.unreachable",
  closed: "aeat_certificate.refused.closed",
  aeat_fault: "aeat_certificate.refused.aeat_fault",
  aeat_http: "aeat_certificate.refused.aeat_http",
  check_failed: "aeat_certificate.refused.check_failed",
};

function refusalOf(answer: InstallAnswerView): Refusal {
  const details = { ...answer.details };
  if (typeof details.date === "string") details.date = calendarDay(details.date);
  const key = Object.hasOwn(REFUSAL_KEYS, answer.reason)
    ? REFUSAL_KEYS[answer.reason]!
    : "aeat_certificate.refused.check_failed";
  return { field: answer.field, message: t(key, details) };
}

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/**
 * Installs or replaces the box's AEAT certificate. The server checks the file and asks AEAT before
 * anything changes; a refusal comes back as the answer, an error only for a failed request.
 */
@customElement("dashboard-aeat-certificate-dialog")
export class AeatCertificateDialog extends LitElement {
  static override styles = [
    baseStyles,
    exportGuidesStyles,
    css`
      .form {
        display: grid;
        gap: var(--wt-space-4);
      }
      p {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      [data-test="reveal"] svg {
        display: block;
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
        fill: none;
        stroke: currentColor;
      }
    `,
  ];

  @property({ attribute: false }) client!: AeatCertificateClient;
  /** The card's revision when the dialog opened; the server refuses the install if it moved. */
  @property({ attribute: false }) revision: string | null = null;
  @property({ attribute: false }) kind: CertificateKind = "sello";
  @state() private draft: Draft = { file: null, passphrase: "", certKind: "sello" };
  @state() private attempted = false;
  @state() private busy = false;
  @state() private visible = false;
  @state() private refusal?: Refusal;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #unsubscribeLocale?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribeLocale = subscribeLocale(() => this.requestUpdate());
    this.draft = { file: null, passphrase: "", certKind: this.kind };
    const { scope, coordinator } = draftScopeFor(this, {
      id: this,
      current: () => ({ ...this.draft }),
      snapshot: (value) => ({ ...value }),
      equal: same,
      restore: (value) => {
        this.draft = { ...value };
      },
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit({ ...this.draft });
  }

  override disconnectedCallback(): void {
    this.#unsubscribeLocale?.();
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #check(field: Field): string {
    if (field === "file") {
      return this.draft.file !== null && this.draft.file.size > CERTIFICATE_MAX_BYTES
        ? t("aeat_certificate.refused.too_large")
        : "";
    }
    return this.draft.passphrase === "" ? t("aeat_certificate.dialog.passphrase_required") : "";
  }

  #fieldError(field: Field): string {
    const own = this.attempted ? this.#check(field) : "";
    return own || (this.refusal?.field === field ? this.refusal.message : "");
  }

  get #failsOwnChecks(): boolean {
    return this.#check("file") !== "" || this.#check("passphrase") !== "";
  }

  #bottom(): string {
    const messages: string[] = [];
    if (this.refusal && this.refusal.field === undefined) messages.push(this.refusal.message);
    if (this.#fieldError("file") || this.#fieldError("passphrase")) {
      messages.push(t("aeat_certificate.dialog.fix_fields"));
    }
    return messages.join(" ");
  }

  #change(next: Partial<Draft>, field?: Field): void {
    if (field !== undefined && this.refusal?.field === field) this.refusal = undefined;
    this.draft = { ...this.draft, ...next };
    this.#scope?.changed();
  }

  async #save(): Promise<void> {
    if (this.busy || this.draft.file === null || saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.refusal = undefined;
    if (this.#failsOwnChecks) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    const submitted = { ...this.draft };
    this.busy = true;
    let answer: InstallAnswerView;
    try {
      answer = await this.client.install({
        pfxBase64: await base64Of(submitted.file!),
        passphrase: submitted.passphrase,
        certKind: submitted.certKind,
        expectedRevision: this.revision,
      });
    } catch (error) {
      if (!this.isConnected) return;
      this.busy = false;
      const code = codeOf(error);
      if (VAULT_MAY_HAVE_CHANGED.has(code)) {
        this.dispatchEvent(
          new CustomEvent("aeat-certificate-changed", { bubbles: true, composed: true }),
        );
      }
      this.refusal = {
        ...(code === "fiscal.certificate_too_large" ? { field: "file" as const } : {}),
        message: codeMessage(code),
      };
      return;
    }
    if (!this.isConnected) return;
    this.busy = false;
    if (answer.outcome === "refused") {
      this.refusal = refusalOf(answer);
      return;
    }
    this.#scope?.commit(submitted);
    this.dispatchEvent(
      new CustomEvent("aeat-certificate-installed", {
        detail: { checkedAt: answer.details?.checkedAt as string },
        bubbles: true,
        composed: true,
      }),
    );
    this.shadowRoot!.querySelector("wt-dialog")!.closeAfter("saved");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.#scope || !this.#leave) return true;
    const outcome = await this.#leave.request({ scopes: [this.#scope.id], reason, proceed() {} });
    return this.isConnected && outcome === "proceeded";
  };

  #passphrase(): TemplateResult {
    const error = this.#fieldError("passphrase");
    return html`<wt-input
      name="certificate-passphrase"
      label=${t("aeat_certificate.dialog.passphrase_label")}
      type=${this.visible ? "text" : "password"}
      autocomplete="off"
      required
      .value=${this.draft.passphrase}
      .error=${error}
      ?invalid=${error !== ""}
      ?disabled=${this.busy}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#change({ passphrase: event.detail.value }, "passphrase");
      }}
    >
      <wt-button
        slot="end"
        variant="ghost"
        data-test="reveal"
        aria-label=${t(
          this.visible
            ? "aeat_certificate.dialog.hide_passphrase"
            : "aeat_certificate.dialog.show_passphrase",
        )}
        @click=${() => {
          this.visible = !this.visible;
        }}
        ><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z"></path>
          <circle cx="8" cy="8" r="2"></circle>
          ${this.visible ? svg`<path d="m2 2 12 12"></path>` : nothing}
        </svg></wt-button
      >
    </wt-input>`;
  }

  override render(): TemplateResult {
    const action = saveActionState(this.#scope);
    const noFile = this.draft.file === null;
    const fileError = this.#fieldError("file");
    return html`<wt-dialog
      open
      heading=${t("aeat_certificate.dialog.title")}
      .dismissible=${!this.busy}
      .beforeClose=${this.#beforeClose}
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=certificate-save]"))}
    >
      <div class="form">
        <p data-test="certificate-intro">${t("aeat_certificate.dialog.intro")}</p>
        <wt-file-input
          name="certificate-file"
          accept=".pfx,.p12"
          label=${t("aeat_certificate.dialog.file_label")}
          required
          .files=${this.draft.file === null ? [] : [this.draft.file]}
          .copy=${{
            drop: t("aeat_certificate.dialog.file_drop"),
            choose: t("aeat_certificate.dialog.file_choose"),
            replace: t("aeat_certificate.dialog.file_replace"),
            previewAlt: t("aeat_certificate.dialog.file_preview"),
          }}
          .error=${fileError}
          ?invalid=${fileError !== ""}
          ?disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ files: File[] }>) => {
            event.stopPropagation();
            this.#change({ file: event.detail.files[0] ?? null }, "file");
          }}
        ></wt-file-input>
        ${this.#passphrase()}
        <wt-combobox
          name="certificate-kind"
          label=${t("aeat_certificate.dialog.kind_label")}
          required
          search="never"
          .options=${KINDS.map((kind) => ({ value: kind, label: t(`aeat_certificate.kind.${kind}`) }))}
          .value=${this.draft.certKind}
          ?disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: CertificateKind }>) => {
            event.stopPropagation();
            this.#change({ certKind: event.detail.value });
          }}
        ></wt-combobox>
        ${exportGuidesView()}
      </div>
      <wt-form-actions slot="footer" .error=${this.#bottom()}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="certificate-cancel"
          ?disabled=${this.busy}
          @click=${() => void this.shadowRoot!.querySelector("wt-dialog")!.requestClose("cancel")}
          >${t("aeat_certificate.dialog.cancel")}</wt-button
        >
        <wt-button
          data-test="certificate-save"
          variant=${noFile ? "secondary" : action.variant}
          ?disabled=${
            noFile || action.unchanged || this.busy || (this.attempted && this.#failsOwnChecks)
          }
          @click=${() => void this.#save()}
          >${t(
            this.busy ? "aeat_certificate.dialog.busy" : "aeat_certificate.dialog.save",
          )}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-aeat-certificate-dialog": AeatCertificateDialog;
  }
}
