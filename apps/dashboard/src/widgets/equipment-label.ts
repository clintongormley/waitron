import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { toDataURL } from "qrcode";
import { applyTokens, baseStyles, type WtModal } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import type { DashboardApi, Printer } from "../api/client.js";
import { codeOf } from "../i18n/codes.js";
import { refusal, bottomMessage } from "../i18n/form-message.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-dialog.js";
import { formatEquipmentCode, type EquipmentKind } from "@waitron/shared";
import { fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

interface NfcWriter {
  write(
    message: { records: { recordType: "text"; data: string }[] },
    options: { signal: AbortSignal },
  ): Promise<void>;
  makeReadOnly(options: { signal: AbortSignal }): Promise<void>;
}
function nfcWriter(): (new () => NfcWriter) | undefined {
  return (window as Window & { NDEFReader?: new () => NfcWriter }).NDEFReader;
}

export interface EquipmentLabelContent {
  qr: string;
  code: string;
  name: string;
}

/**
 * Prints the label alone, from a frame of its own: printing the page would print the dashboard
 * around the dialog. The name is set as text, never parsed as markup.
 */
export function printEquipmentLabel(
  label: EquipmentLabelContent,
  printFrame: (view: Window) => void = (view) => view.print(),
): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  applyTokens(frame);
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.addEventListener("load", () => {
    const view = frame.contentWindow!;
    const doc = frame.contentDocument!;
    const tokens = getComputedStyle(frame);
    for (const token of [
      "--wt-font-family",
      "--wt-font-size-md",
      "--wt-font-size-xl",
      "--wt-font-weight-bold",
    ])
      doc.documentElement.style.setProperty(token, tokens.getPropertyValue(token));
    const style = doc.createElement("style");
    style.textContent =
      "body{margin:0;font-family:var(--wt-font-family);font-size:var(--wt-font-size-md);text-align:center}" +
      "img{width:40mm;height:40mm}p{margin:2mm 0;overflow-wrap:anywhere}p:first-of-type{font-size:var(--wt-font-size-xl);font-weight:var(--wt-font-weight-bold)}";
    doc.head.append(style);
    const image = doc.createElement("img");
    image.src = label.qr;
    image.alt = "";
    const code = doc.createElement("p");
    code.textContent = label.code;
    const name = doc.createElement("p");
    name.textContent = label.name;
    doc.body.append(image, name, code);
    view.addEventListener("afterprint", () => frame.remove(), { once: true });
    image.decode().then(
      () => printFrame(view),
      () => frame.remove(),
    );
  });
  frame.srcdoc = "<!doctype html><title>Waitron</title>";
  document.body.append(frame);
}

@customElement("dashboard-equipment-label")
export class EquipmentLabel extends LitElement {
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
      .copy {
        display: flex;
        justify-content: center;
        margin-block: var(--wt-space-2);
      }
      .message {
        margin-block: var(--wt-space-3) 0;
        color: var(--wt-color-text);
      }
    `,
  ];

  @property() kind: EquipmentKind = "printer";
  @property() itemId = "";
  @property() name = "";
  @property({ attribute: false }) api:
    Pick<DashboardApi, "listPrinters" | "printEquipmentLabel"> | undefined;
  @state() private printerChoiceOpen = false;
  @state() private printerChoices: Printer[] = [];
  @state() private printerId = "";
  @state() private printerLoading = false;
  @state() private printerSending = false;
  @state() private printerError: unknown = null;
  @state() private printerQueued = false;

  async #choosePrinter(): Promise<void> {
    if (!this.api || this.printerLoading) return;
    const generation = this.#generation;
    this.printerChoiceOpen = true;
    this.printerLoading = true;
    this.printerError = null;
    try {
      const printers = await this.api.listPrinters();
      if (this.#generation !== generation || !this.isConnected) return;
      this.printerChoices = printers.filter((p) => p.active);
      if (this.kind === "printer")
        this.printerChoices.sort(
          (a, b) => Number(b.id === this.itemId) - Number(a.id === this.itemId),
        );
    } catch (error) {
      if (this.#generation === generation && this.isConnected) this.printerError = error;
    } finally {
      if (this.#generation === generation) this.printerLoading = false;
    }
  }

  async #sendToPrinter(): Promise<void> {
    if (
      !this.api ||
      this.printerSending ||
      this.printerLoading ||
      !this.printerChoices.some((p) => p.id === this.printerId)
    )
      return;
    const generation = this.#generation;
    this.printerSending = true;
    this.printerError = null;
    this.printerQueued = false;
    try {
      await this.api.printEquipmentLabel(this.printerId, { kind: this.kind, id: this.itemId });
      if (this.#generation === generation && this.isConnected) this.printerQueued = true;
    } catch (error) {
      if (this.#generation === generation && this.isConnected) this.printerError = error;
    } finally {
      if (this.#generation === generation) this.printerSending = false;
    }
  }

  #printerChoice(): TemplateResult | typeof nothing {
    if (!this.printerChoiceOpen) return nothing;
    const enabled =
      !this.printerLoading && this.printerChoices.some((p) => p.id === this.printerId);
    return html`<div class="printer-choice">
      <wt-combobox
        data-test="equipment-label-printer"
        name="equipmentLabelPrinterId"
        required
        label=${t("equipment.choose_printer")}
        search="auto"
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .options=${this.printerChoices.map((p) => ({ value: p.id, label: p.name }))}
        .value=${this.printerId}
        ?disabled=${this.printerLoading || this.printerSending}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.printerId = event.detail.value;
          this.printerQueued = false;
        }}
      ></wt-combobox>
      ${this.printerLoading ? html`<p role="status">${t("equipment.loading_printers")}</p>` : nothing}
      ${!this.printerLoading && this.printerChoices.length === 0 ? html`<p>${t("equipment.no_printers")}</p>` : nothing}
      ${this.printerQueued ? html`<p role="status" data-test="equipment-label-printer-status">${t("equipment.print_queued")}</p>` : nothing}
      <wt-form-actions
        data-test="equipment-label-printer-actions"
        .error=${bottomMessage(refusal(this.printerError === null ? null : codeOf(this.printerError)))}
      >
        ${this.printerError && this.printerChoices.length === 0 ? html`<wt-button data-test="retry-equipment-printers" @click=${() => void this.#choosePrinter()}>${t("equipment.retry_printers")}</wt-button>` : nothing}
        <wt-button
          data-test="send-equipment-label"
          variant=${enabled ? "primary" : "secondary"}
          ?disabled=${!enabled || this.printerSending}
          .loading=${this.printerSending}
          @click=${() => void this.#sendToPrinter()}
          >${t("equipment.venue_print")}</wt-button
        >
      </wt-form-actions>
    </div>`;
  }

  /** Where focus returns when the label closes. */
  @property({ attribute: false }) opener: HTMLElement | null = null;
  /** Replaced in tests, which cannot answer a print dialog. */
  @property({ attribute: false }) print: (label: EquipmentLabelContent) => void = (label) =>
    printEquipmentLabel(label);
  /** Replaced in tests, which hold a drawing back. */
  @property({ attribute: false }) drawQr: (code: string) => Promise<string> = (code) =>
    toDataURL(code, { margin: 2, width: 320 });

  @state() private qr = "";
  @state() private nfcBusy: "write" | "lock" | "" = "";
  @state() private nfcMessage: StringKey | null = null;
  @state() private nfcWritten = false;
  @state() private confirmLock = false;
  #nfcOperation: AbortController | undefined;
  #generation = 0;

  #resetNfc(): void {
    this.#generation++;
    this.printerChoiceOpen = false;
    this.printerChoices = [];
    this.printerId = "";
    this.printerLoading = false;
    this.printerSending = false;
    this.printerError = null;
    this.printerQueued = false;
    this.#nfcOperation?.abort();
    this.#nfcOperation = undefined;
    this.nfcBusy = "";
    this.nfcMessage = null;
    this.nfcWritten = false;
    this.confirmLock = false;
  }

  override disconnectedCallback(): void {
    this.#resetNfc();
    super.disconnectedCallback();
  }

  async #copy(): Promise<void> {
    const code = this.#code();
    const generation = this.#generation;
    try {
      await navigator.clipboard.writeText(code);
      if (
        this.#generation === generation &&
        this.isConnected &&
        this.#code() === code &&
        this.nfcBusy === ""
      )
        this.nfcMessage = "equipment.code_copied";
    } catch {
      if (
        this.#generation === generation &&
        this.isConnected &&
        this.#code() === code &&
        this.nfcBusy === ""
      )
        this.nfcMessage = "equipment.copy_failed";
    }
  }

  async #nfc(operation: "write" | "lock"): Promise<void> {
    const Writer = nfcWriter();
    if (
      !Writer ||
      this.nfcBusy !== "" ||
      (operation === "write" && this.confirmLock) ||
      (operation === "lock" && (!this.nfcWritten || !this.confirmLock))
    )
      return;
    this.confirmLock = false;
    this.nfcBusy = operation;
    this.nfcMessage = "equipment.nfc_hold";
    if (operation === "write") this.nfcWritten = false;
    const controller = new AbortController();
    this.#nfcOperation = controller;
    try {
      const writer = new Writer();
      if (operation === "write")
        await writer.write(
          { records: [{ recordType: "text", data: this.#code() }] },
          { signal: controller.signal },
        );
      else await writer.makeReadOnly({ signal: controller.signal });
      if (controller.signal.aborted) return;
      this.nfcWritten = operation === "write";
      this.nfcMessage = operation === "write" ? "equipment.nfc_written" : "equipment.nfc_locked";
    } catch {
      if (!controller.signal.aborted) this.nfcMessage = "equipment.nfc_failed";
    } finally {
      if (this.#nfcOperation === controller) {
        this.#nfcOperation = undefined;
        this.nfcBusy = "";
      }
    }
  }

  #code(): string {
    return formatEquipmentCode(this.kind, this.itemId);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("kind") || changed.has("itemId")) {
      this.#resetNfc();
      this.qr = "";
      const code = this.#code();
      void this.drawQr(code).then((qr) => {
        if (this.#code() === code) this.qr = qr;
      });
    }
  }

  /** Closes the dialog; `wt-close` follows once it has. */
  #close(): void {
    this.#resetNfc();
    this.renderRoot.querySelector<WtModal>("wt-modal")!.open = false;
  }

  override render(): TemplateResult {
    const code = this.#code();
    return html`<wt-modal
        size="compact"
        data-test="equipment-label-modal"
        heading=${fill("equipment.label_title", { name: this.name })}
        .open=${true}
        .opener=${this.opener}
        @wt-close=${() => this.#resetNfc()}
      >
        <p class="hint">${t("equipment.label_hint")}</p>
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
          <code data-test="equipment-label-code">${code}</code>
        </figure>
        <div class="copy">
          <wt-button data-test="copy-equipment-code" @click=${() => void this.#copy()}
            >${t("equipment.copy_code")}</wt-button
          >
        </div>
        ${nfcWriter() ? nothing : html`<p class="hint" data-test="equipment-nfc-unavailable">${t("equipment.nfc_android")}</p>`}
        ${this.nfcMessage === null ? nothing : html`<p class="message" role="status" data-test="equipment-nfc-message">${t(this.nfcMessage)}</p>`}
        ${this.#printerChoice()}
        <wt-form-actions slot="footer">
          <wt-button slot="cancel" data-test="close-equipment-label" @click=${() => this.#close()}
            >${t("action.close")}</wt-button
          >
          <wt-button
            variant=${this.qr === "" ? "secondary" : "primary"}
            data-test="print-equipment-label"
            ?disabled=${this.qr === ""}
            @click=${() => this.print({ qr: this.qr, code, name: this.name })}
            >${t("equipment.print")}</wt-button
          >
          <wt-button
            data-test="venue-print-equipment-label"
            ?disabled=${!this.api || this.printerLoading || this.printerSending}
            variant=${this.api && !this.printerLoading && !this.printerSending ? "primary" : "secondary"}
            @click=${() => void this.#choosePrinter()}
            >${t("equipment.venue_print")}</wt-button
          >
          <wt-button
            variant=${nfcWriter() && !this.confirmLock && this.nfcBusy !== "lock" ? "primary" : "secondary"}
            data-test="write-equipment-nfc"
            ?disabled=${!nfcWriter() || this.nfcBusy !== "" || this.confirmLock}
            .loading=${this.nfcBusy === "write"}
            @click=${() => void this.#nfc("write")}
            >${t("equipment.nfc_write")}</wt-button
          >
          ${
            this.nfcWritten
              ? html`<wt-button
                  variant="danger"
                  data-test="lock-equipment-nfc"
                  ?disabled=${this.nfcBusy !== "" || this.confirmLock}
                  .loading=${this.nfcBusy === "lock"}
                  @click=${() => {
                    if (this.nfcBusy === "") this.confirmLock = true;
                  }}
                  >${t("equipment.nfc_lock")}</wt-button
                >`
              : nothing
          }
        </wt-form-actions>
      </wt-modal>
      <wt-dialog
        data-test="lock-equipment-nfc-confirmation"
        heading=${t("equipment.nfc_lock")}
        .open=${this.confirmLock}
        .opener=${this.renderRoot.querySelector<HTMLElement>("[data-test=close-equipment-label]")}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          this.confirmLock = false;
        }}
      >
        <p>${t("equipment.nfc_lock_confirmation")}</p>
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            data-test="cancel-lock-equipment-nfc"
            @click=${() => {
              this.renderRoot.querySelector<HTMLElementTagNameMap["wt-dialog"]>("wt-dialog")!.open =
                false;
            }}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            variant="danger"
            data-test="confirm-lock-equipment-nfc"
            @click=${() => void this.#nfc("lock")}
            >${t("equipment.nfc_lock")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-equipment-label": EquipmentLabel;
  }
}
