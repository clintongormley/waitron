import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { DashboardApi } from "../api/client.js";
import { codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { renderNodeRecoveryPack } from "./node-recovery-print.js";
import { LocaleChangeController } from "../state/locale-controller.js";

interface Draft {
  key: string;
  file: File | undefined;
}

@customElement("dashboard-node-recovery")
export class NodeRecoveryPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h2 {
        font-size: var(--wt-font-size-lg);
        margin-block: 0 var(--wt-space-3);
      }
      p,
      label {
        margin-block: var(--wt-space-3);
      }
      wt-input {
        margin-block: var(--wt-space-4);
      }
      label {
        display: block;
      }
      input[type="file"] {
        max-width: 100%;
      }
      .error {
        color: var(--wt-color-danger);
      }
      .downloads {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
        align-items: center;
      }
      a {
        color: var(--wt-color-primary-text);
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
      }
    `,
  ];
  @property({ attribute: false }) api!: Pick<DashboardApi, "createNodeRecoveryPack">;
  @state() private key = "";
  @state() private file?: File;
  @state() private busy = false;
  @state() private keyError = false;
  @state() private fileError = false;
  @state() private failed = false;
  @state() private output?: { json: string; html: string; name: string };
  #generation = 0;
  #request = 0;
  #scope?: DraftScope<Draft>;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = draftScopeFor(this, {
      id: this,
      current: () => ({ key: this.key, file: this.file }),
      snapshot: (value: Draft) => ({ ...value }),
      equal: (a: Draft, b: Draft) => a.key === b.key && a.file === b.file,
      restore: (value: Draft) => {
        this.#generation++;
        this.key = value.key;
        this.file = value.file;
        this.#resetOutput();
        this.#resetFileInput();
      },
    }).scope;
    this.#scope.commit({ key: "", file: undefined });
  }

  override disconnectedCallback(): void {
    this.#generation++;
    this.#request++;
    this.busy = false;
    this.key = "";
    this.file = undefined;
    this.#resetFileInput();
    this.#resetOutput();
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  #resetFileInput(): void {
    const input = this.shadowRoot?.querySelector<HTMLInputElement>("input[type=file]");
    if (input) {
      const transfer = new DataTransfer();
      if (this.file) transfer.items.add(this.file);
      input.files = transfer.files;
    }
  }

  #resetOutput(): void {
    if (this.output) {
      URL.revokeObjectURL(this.output.json);
      URL.revokeObjectURL(this.output.html);
    }
    this.output = undefined;
  }

  #edited(): void {
    this.#generation++;
    this.#resetOutput();
    this.keyError = false;
    this.fileError = false;
    this.failed = false;
    this.#scope?.changed();
  }

  async #create(): Promise<void> {
    if (this.busy || !this.key || !this.file) return;
    const generation = ++this.#generation;
    const request = ++this.#request;
    const key = this.key;
    const file = this.file;
    this.busy = true;
    this.keyError = this.fileError = this.failed = false;
    try {
      let modules: Record<string, unknown>;
      try {
        if (file.size > 131072) throw new Error("oversized");
        const content = await file.text();
        const parsed: unknown = JSON.parse(content);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed) ||
          content.includes("PRIVATE KEY")
        )
          throw new Error("invalid");
        modules = parsed as Record<string, unknown>;
      } catch {
        if (generation === this.#generation) this.fileError = true;
        return;
      }
      if (generation !== this.#generation) return;
      const pack = await this.api.createNodeRecoveryPack(key, modules);
      if (generation !== this.#generation) return;
      const printable = renderNodeRecoveryPack(pack, this);
      this.output = {
        json: URL.createObjectURL(
          new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }),
        ),
        html: URL.createObjectURL(new Blob([printable], { type: "text/html" })),
        name: pack.nodeRecovery.name,
      };
      this.key = "";
      this.file = undefined;
      this.#resetFileInput();
      this.#scope?.commit({ key: "", file: undefined });
    } catch (error) {
      if (generation !== this.#generation) return;
      if (codeOf(error) === "promotion.break_glass_invalid") this.keyError = true;
      else this.failed = true;
    } finally {
      if (request === this.#request) this.busy = false;
    }
  }

  override render() {
    const ready = this.key.length > 0 && this.file !== undefined;
    return html` <section aria-labelledby="node-pack-title">
      <h2 id="node-pack-title">${t("node_pack.title")}</h2>
      <p>${t("node_pack.intro")}</p>
      <wt-input
        data-test="node-key"
        name="node-recovery-key"
        type="password"
        autocomplete="off"
        required
        label=${t("node_pack.key")}
        .value=${this.key}
        ?disabled=${this.busy}
        error=${this.keyError ? t("node_pack.key_error") : ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.key = event.detail.value;
          this.#edited();
        }}
      ></wt-input>
      <label for="node-register">${t("node_pack.file")} <span aria-hidden="true">*</span></label>
      <input
        id="node-register"
        data-test="register-file"
        name="signed-allocation-register"
        type="file"
        accept="application/json,.json"
        required
        ?disabled=${this.busy}
        aria-invalid=${this.fileError ? "true" : "false"}
        aria-describedby="node-register-error"
        @change=${(event: Event) => {
          this.file = (event.currentTarget as HTMLInputElement).files?.[0];
          this.#edited();
        }}
      />
      <p id="node-register-error" class="error" data-test="file-error">
        ${this.fileError ? t("node_pack.file_error") : nothing}
      </p>
      <wt-form-actions
        .error=${this.failed ? t("node_pack.failed") : this.keyError || this.fileError ? t("form.fix_fields") : ""}
      >
        <wt-button
          data-test="create-pack"
          variant=${ready || this.busy ? "primary" : "secondary"}
          ?disabled=${!ready || this.busy}
          @click=${() => void this.#create()}
          >${t("node_pack.create")}</wt-button
        >
      </wt-form-actions>
      ${
        this.output
          ? html` <p data-test="key-name">${this.output.name}</p>
              <p>${t("node_pack.secret_warning")}</p>
              <div class="downloads">
                <a
                  data-test="download-pack"
                  href=${this.output.json}
                  download="waitron-node-recovery.json"
                  >${t("node_pack.download")}</a
                >
                <a
                  data-test="print-pack"
                  href=${this.output.html}
                  download="waitron-node-recovery.html"
                  >${t("node_pack.print")}</a
                >
                <wt-button
                  data-test="clear-pack"
                  variant="ghost"
                  @click=${() => this.#resetOutput()}
                  >${t("node_pack.clear")}</wt-button
                >
              </div>`
          : nothing
      }
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-node-recovery": NodeRecoveryPanel;
  }
}
