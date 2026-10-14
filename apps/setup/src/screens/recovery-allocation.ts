import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, focusFirstInvalid, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { RecoveryBackupPreview, RecoveryRestoreCredentials } from "../api/client.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { t } from "../i18n/t.js";
import { fieldStyles, errorStyles } from "../form-styles.js";

export type RecoveryEntryField = "recoveryOperation" | "nodeRecoverySecret";

interface Draft {
  record: string;
  nodeKey: string;
  isolated: boolean;
  retained: boolean;
}
const empty = (): Draft => ({ record: "", nodeKey: "", isolated: false, retained: false });
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}

@customElement("setup-recovery-allocation")
export class SetupRecoveryAllocation extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    errorStyles,
    css`
      :host {
        display: block;
        margin-block-start: var(--wt-space-4);
      }
      h3 {
        font-size: var(--wt-font-size-lg);
      }
      .review {
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-4);
        margin-block: var(--wt-space-4);
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: inherit;
      }
      a {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        color: var(--wt-color-primary-text);
      }
    `,
  ];
  @property({ attribute: false }) preview?: RecoveryBackupPreview;
  @property() errorMessage?: string;
  @property() refusedField?: string;
  @state() private refusalDismissed = false;
  @state() private draft = empty();
  @state() private attempted = false;
  #scope?: DraftScope<Draft>;
  #review?: { text: string; url: string };
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("errorMessage") || changed.has("refusedField")) this.refusalDismissed = false;
    if (changed.has("preview")) this.#clear();
    this.#reviewRequest();
    this.#registerScope();
  }
  override connectedCallback(): void {
    super.connectedCallback();
    this.#registerScope();
  }
  #registerScope(): void {
    if (this.isConnected && !this.#scope) {
      this.#scope = draftScopeFor(this, {
        id: this,
        current: () => this.draft,
        snapshot: (draft) => ({ ...draft }),
        equal: (a, b) =>
          a.record === b.record &&
          a.nodeKey === b.nodeKey &&
          a.isolated === b.isolated &&
          a.retained === b.retained,
        restore: () => this.#clear(),
      }).scope;
      this.#scope.commit(empty());
    }
  }
  override disconnectedCallback(): void {
    this.#clear();
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  #clear(): void {
    this.#releaseReview();
    this.draft = empty();
    this.attempted = false;
    this.#scope?.commit(empty());
    this.#notify();
  }
  #edit<K extends keyof Draft>(key: K, value: Draft[K]): void {
    this.draft = {
      ...this.draft,
      ...(key === "record" && value !== this.draft.record ? { retained: false } : {}),
      [key]: value,
    };
    const field =
      key === "record" ? "recoveryOperation" : key === "nodeKey" ? "nodeRecoverySecret" : undefined;
    if (field !== undefined && field === this.refusedField) {
      this.refusalDismissed = true;
      this.dispatchEvent(
        new CustomEvent("recovery-field-edited", {
          detail: { field },
          bubbles: true,
          composed: true,
        }),
      );
    }
    this.#scope?.changed();
    this.#notify();
  }
  #releaseReview(): void {
    if (this.#review) URL.revokeObjectURL(this.#review.url);
    this.#review = undefined;
  }
  #reviewRequest(): void {
    const operation = this.#operation();
    const text = operation
      ? JSON.stringify(
          {
            version: 1,
            kind: "recovery-request",
            selectedBackup: this.preview,
            recoveryOperation: operation,
          },
          null,
          2,
        )
      : undefined;
    if (text === this.#review?.text) return;
    this.#releaseReview();
    if (text !== undefined && this.isConnected)
      this.#review = {
        text,
        url: URL.createObjectURL(new Blob([text], { type: "application/json" })),
      };
  }
  #notify(): void {
    this.dispatchEvent(
      new CustomEvent("recovery-invalid", {
        detail: {
          invalid:
            this.attempted &&
            (!this.#operation() ||
              this.#keyInvalid ||
              !this.draft.isolated ||
              !this.draft.retained),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #operation(): RecoveryRestoreCredentials["recoveryOperation"] | undefined {
    if (!this.preview || new TextEncoder().encode(this.draft.record).length > 131072) return;
    try {
      const value: unknown = JSON.parse(this.draft.record);
      if (
        !exact(value, ["binding", "input"]) ||
        !exact(value.binding, ["module", "action", "eventId", "sourceId", "targetNodeId"])
      )
        return;
      const binding = value.binding;
      if (
        !text(binding.module) ||
        !/^[a-z][a-z0-9-]*$/.test(binding.module) ||
        binding.action !== "restore" ||
        !text(binding.eventId) ||
        !text(binding.sourceId) ||
        binding.sourceId !== (this.preview.activationSourceId ?? this.preview.sourceId) ||
        typeof binding.targetNodeId !== "string" ||
        binding.targetNodeId.toLowerCase() !== this.preview.nodeId.toLowerCase()
      )
        return;
      return value as unknown as RecoveryRestoreCredentials["recoveryOperation"];
    } catch {
      return;
    }
  }
  readCredentials(): RecoveryRestoreCredentials | undefined | null {
    if (Object.entries(this.draft).every(([, value]) => value === "" || value === false)) return;
    this.attempted = true;
    this.refusalDismissed = true;
    this.#notify();
    const operation = this.#operation();
    if (!operation || this.#keyInvalid || !this.draft.isolated || !this.draft.retained) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return null;
    }
    return { recoveryOperation: operation, nodeRecoverySecret: this.draft.nodeKey };
  }
  get #hasDraft(): boolean {
    return Object.values(this.draft).some((value) => value !== "" && value !== false);
  }
  get #keyInvalid(): boolean {
    return this.draft.nodeKey === "" || new TextEncoder().encode(this.draft.nodeKey).length > 4096;
  }
  #refusal(field: RecoveryEntryField): string {
    return !this.refusalDismissed && this.refusedField === field ? (this.errorMessage ?? "") : "";
  }
  override render() {
    const recordInvalid = this.attempted && !this.#operation();
    const keyInvalid = this.attempted && this.#keyInvalid;
    const isolatedInvalid = this.attempted && !this.draft.isolated;
    const retainedInvalid = this.attempted && !this.draft.retained;
    return html` <h3>${t("restore.allocation_heading")}</h3>
      <p>${t("restore.allocation_intro")}</p>
      <wt-textarea
        class="field"
        name="recovery-record"
        label=${t("restore.allocation_record")}
        placeholder=${t("restore.allocation_placeholder")}
        data-test="record"
        ?required=${this.#hasDraft}
        .rows=${6}
        .value=${this.draft.record}
        .error=${recordInvalid ? t("restore.allocation_invalid") : this.#refusal("recoveryOperation")}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.#edit("record", event.detail.value);
        }}
      ></wt-textarea>
      <wt-input
        class="field"
        name="node-recovery-key"
        type="password"
        autocomplete="off"
        label=${t("restore.allocation_node_key")}
        data-test="node-key"
        ?required=${this.#hasDraft}
        .value=${this.draft.nodeKey}
        .error=${keyInvalid ? t("restore.allocation_key_missing") : this.#refusal("nodeRecoverySecret")}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.#edit("nodeKey", event.detail.value);
        }}
      ></wt-input>
      ${
        this.#review
          ? html`<section
              class="review"
              data-test="request-review"
              aria-labelledby="request-heading"
            >
              <h4 id="request-heading">${t("restore.allocation_review")}</h4>
              <p>${t("restore.allocation_request_warning")}</p>
              <pre>${this.#review.text}</pre>
              <a
                data-test="download-request"
                href=${this.#review.url}
                download="waitron-recovery-request.json"
                >${t("restore.allocation_download")}</a
              >
            </section>`
          : nothing
      }
      <label class="field"
        ><input
          name="recovery-isolated"
          type="checkbox"
          ?required=${this.#hasDraft}
          data-test="isolated"
          aria-invalid=${isolatedInvalid ? "true" : "false"}
          aria-describedby="isolated-error"
          .checked=${this.draft.isolated}
          @change=${(event: Event) => this.#edit("isolated", (event.currentTarget as HTMLInputElement).checked)}
        />${t("restore.allocation_isolated")}</label
      >
      <p class="error" id="isolated-error">
        ${isolatedInvalid ? t("restore.allocation_isolation_missing") : ""}
      </p>
      <label class="field"
        ><input
          name="recovery-record-kept"
          type="checkbox"
          ?required=${this.#hasDraft}
          data-test="retained"
          aria-invalid=${retainedInvalid ? "true" : "false"}
          aria-describedby="retained-error"
          .checked=${this.draft.retained}
          @change=${(event: Event) => this.#edit("retained", (event.currentTarget as HTMLInputElement).checked)}
        />${t("restore.allocation_retained")}</label
      >
      <p class="error" id="retained-error">
        ${retainedInvalid ? t("restore.allocation_retention_missing") : ""}
      </p>
      <wt-form-actions>
        <wt-button variant="secondary" data-test="clear" @click=${() => this.#clear()}
          >${t("restore.allocation_clear")}</wt-button
        >
      </wt-form-actions>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "setup-recovery-allocation": SetupRecoveryAllocation;
  }
}
