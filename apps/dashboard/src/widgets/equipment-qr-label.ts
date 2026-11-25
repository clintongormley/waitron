import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { toDataURL } from "qrcode";
import { baseStyles, type WtButton, type WtModal, type WtRowActions } from "@waitron/ui";
import { printEquipmentLabel, type EquipmentLabelContent } from "@waitron/ui/src/print-label.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { formatEquipmentCode, type EquipmentKind } from "@waitron/shared";
import type { DashboardApi, Printer } from "../api/client.js";
import { codeOf } from "../i18n/codes.js";
import { refusal, bottomMessage } from "../i18n/form-message.js";
import { fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

@customElement("dashboard-equipment-qr-label")
export class EquipmentQrLabel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      figure {
        margin: 0;
        display: grid;
        justify-items: center;
        gap: var(--wt-space-2);
        text-align: center;
      }
      .qr {
        width: calc(var(--wt-space-6) * 6);
        max-width: 100%;
        height: auto;
      }
      .name {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      code {
        overflow-wrap: anywhere;
        color: var(--wt-color-text);
      }
      .hint {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }
      .code {
        display: grid;
        justify-items: center;
        gap: var(--wt-space-2);
        text-align: center;
      }
      .message {
        margin: 0;
        color: var(--wt-color-text);
      }
      .message.printed {
        margin-block-start: var(--wt-space-3);
      }
      /* The trigger looks like the wt-button it stands in for. */
      wt-row-actions::part(trigger) {
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid transparent;
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        font-weight: var(--wt-font-weight-bold);
      }
      wt-row-actions::part(trigger):hover {
        background: var(--wt-color-primary-hover);
      }
    `,
  ];

  @property() kind: EquipmentKind = "printer";
  @property() itemId = "";
  @property() name = "";
  @property({ attribute: false }) api:
    Pick<DashboardApi, "listPrinters" | "printEquipmentLabel"> | undefined;
  /** Where focus returns when the label closes. */
  @property({ attribute: false }) opener: HTMLElement | null = null;
  /** Replaced in tests, which cannot answer a print dialog. */
  @property({ attribute: false }) print: (label: EquipmentLabelContent) => void = (label) =>
    printEquipmentLabel(label);
  /** Replaced in tests, which hold a drawing back. */
  @property({ attribute: false }) drawQr: (code: string) => Promise<string> = (code) =>
    toDataURL(code, { margin: 2, width: 320 });

  @state() private qr = "";
  @state() private codeShown = false;
  @state() private copyMessage: StringKey | null = null;
  @state() private printers: Printer[] = [];
  @state() private loading = false;
  @state() private sending = false;
  @state() private queued = false;
  @state() private readError: unknown = null;
  @state() private printError: unknown = null;
  #generation = 0;
  #printHadFocus = false;

  #reset(): void {
    this.#generation++;
    this.codeShown = false;
    this.copyMessage = null;
    this.printers = [];
    this.loading = false;
    this.sending = false;
    this.queued = false;
    this.readError = null;
    this.printError = null;
  }

  override disconnectedCallback(): void {
    this.#reset();
    super.disconnectedCallback();
  }

  #code(): string {
    return formatEquipmentCode(this.kind, this.itemId);
  }

  #printControl(): WtButton | WtRowActions | null {
    return this.renderRoot.querySelector<WtButton | WtRowActions>(
      "[data-test=print-equipment-label]",
    );
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    this.#printHadFocus =
      this.hasUpdated && this.#printControl() === this.shadowRoot!.activeElement;
    if (changed.has("kind") || changed.has("itemId")) {
      this.#reset();
      this.qr = "";
      const code = this.#code();
      void this.drawQr(code).then((qr) => {
        if (this.#code() === code) this.qr = qr;
      });
      void this.#loadPrinters();
    }
  }

  protected override updated(): void {
    if (this.#printHadFocus && this.shadowRoot!.activeElement === null) void this.#refocusPrint();
  }

  /** Print changes between a button and a menu, taking the one focus was on away with it. */
  async #refocusPrint(): Promise<void> {
    const control = this.#printControl();
    await control?.updateComplete;
    if (this.shadowRoot!.activeElement === null) control?.focus();
  }

  async #loadPrinters(): Promise<void> {
    if (!this.api) return;
    const generation = this.#generation;
    this.loading = true;
    this.readError = null;
    try {
      const printers = (await this.api.listPrinters()).filter((p) => p.active);
      if (this.#generation !== generation) return;
      if (this.kind === "printer")
        printers.sort((a, b) => Number(b.id === this.itemId) - Number(a.id === this.itemId));
      this.printers = printers;
    } catch (error) {
      if (this.#generation === generation) this.readError = error;
    } finally {
      if (this.#generation === generation) this.loading = false;
    }
  }

  async #send(printer: Printer): Promise<void> {
    if (!this.api || this.sending) return;
    const generation = this.#generation;
    this.sending = true;
    this.printError = null;
    this.queued = false;
    try {
      await this.api.printEquipmentLabel(printer.id, { kind: this.kind, id: this.itemId });
      if (this.#generation === generation) this.queued = true;
    } catch (error) {
      if (this.#generation === generation) this.printError = error;
    } finally {
      if (this.#generation === generation) this.sending = false;
    }
  }

  #printHere(): void {
    this.print({ qr: this.qr, code: this.#code(), name: this.name });
  }

  async #copy(): Promise<void> {
    const generation = this.#generation;
    let message: StringKey = "equipment.code_copied";
    try {
      await navigator.clipboard.writeText(this.#code());
    } catch {
      message = "equipment.copy_failed";
    }
    if (this.#generation === generation) this.copyMessage = message;
  }

  /** Closes the dialog; `wt-close` follows once it has. */
  #close(): void {
    this.#reset();
    this.renderRoot.querySelector<WtModal>("wt-modal")!.open = false;
  }

  #renderCode(): TemplateResult {
    return html`<div class="code">
      <wt-button
        variant="link"
        data-test="show-equipment-code"
        aria-expanded=${this.codeShown ? "true" : "false"}
        @click=${() => {
          this.codeShown = !this.codeShown;
          this.copyMessage = null;
        }}
        >${t(this.codeShown ? "equipment.hide_code" : "equipment.show_code")}</wt-button
      >
      ${
        this.codeShown
          ? html`<code data-test="equipment-label-code">${this.#code()}</code>
              <wt-button data-test="copy-equipment-code" @click=${() => void this.#copy()}
                >${t("equipment.copy_code")}</wt-button
              >
              ${
                this.copyMessage === null
                  ? nothing
                  : html`<p class="message" role="status" data-test="equipment-code-message">
                      ${t(this.copyMessage)}
                    </p>`
              }`
          : nothing
      }
    </div>`;
  }

  #renderPrint(): TemplateResult {
    const drawing = this.qr === "";
    const waiting = drawing || this.loading;
    const straight = this.printers.length === 0 && this.readError === null;
    if (waiting || this.sending || straight)
      return html`<wt-button
        variant=${waiting ? "secondary" : "primary"}
        data-test="print-equipment-label"
        ?disabled=${drawing}
        .loading=${!drawing && (this.loading || this.sending)}
        @click=${() => this.#printHere()}
        >${t("equipment.print")}</wt-button
      >`;
    return html`<wt-row-actions
      data-test="print-equipment-label"
      align="end"
      label=${t("equipment.print")}
    >
      <span slot="trigger">${t("equipment.print")} ▾</span>
      ${this.printers.map(
        (printer) =>
          html`<wt-button
            icon="menu-print"
            data-test=${`print-label-on-${printer.id}`}
            @click=${() => void this.#send(printer)}
            >${printer.name}</wt-button
          >`,
      )}
      ${this.printers.length === 0 ? nothing : html`<hr part="menu-divider" />`}
      <wt-button
        icon="menu-print"
        data-test="print-label-on-this-computer"
        @click=${() => this.#printHere()}
        >${t("equipment.print_here")}</wt-button
      >
    </wt-row-actions>`;
  }

  override render(): TemplateResult {
    const error = this.printError ?? this.readError;
    return html`<wt-modal
      size="compact"
      data-test="equipment-label-modal"
      heading=${fill("equipment.qr_label_title", { name: this.name })}
      .open=${true}
      .opener=${this.opener}
      @wt-close=${() => this.#reset()}
    >
      <p class="hint">
        ${t(this.kind === "printer" ? "equipment.label_hint_printer" : "equipment.label_hint_reader")}
      </p>
      <figure>
        ${
          this.qr === ""
            ? nothing
            : html`<img
                class="qr"
                data-test="equipment-label-qr"
                src=${this.qr}
                alt=${t("equipment.label_qr_alt")}
              />`
        }
        <p class="name" data-test="equipment-label-name">${this.name}</p>
      </figure>
      ${this.#renderCode()}
      ${
        this.queued
          ? html`<p
              class="message printed"
              role="status"
              data-test="equipment-label-printer-status"
            >
              ${t("equipment.print_queued")}
            </p>`
          : nothing
      }
      <wt-form-actions
        slot="footer"
        data-test="equipment-label-actions"
        .error=${bottomMessage(refusal(error === null ? null : codeOf(error)))}
      >
        <wt-button slot="cancel" data-test="close-equipment-label" @click=${() => this.#close()}
          >${t("action.close")}</wt-button
        >
        ${
          this.readError === null
            ? nothing
            : html`<wt-button
                data-test="retry-equipment-printers"
                @click=${() => void this.#loadPrinters()}
                >${t("equipment.try_again")}</wt-button
              >`
        }
        ${this.#renderPrint()}
      </wt-form-actions>
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-equipment-qr-label": EquipmentQrLabel;
  }
}
