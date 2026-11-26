import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type WtModal } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-modal.js";
import { formatEquipmentCode, type EquipmentKind } from "@waitron/shared";
import { fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

interface NfcWriter {
  scan(options: { signal: AbortSignal }): Promise<void>;
  write(
    message: { records: { recordType: "text"; data: string }[] },
    options: { signal: AbortSignal },
  ): Promise<void>;
  makeReadOnly(options: { signal: AbortSignal }): Promise<void>;
}

export function nfcWriter(): (new () => NfcWriter) | undefined {
  return (window as Window & { NDEFReader?: new () => NfcWriter }).NDEFReader;
}

type Step =
  | "idle"
  | "writing"
  | "written"
  | "failed"
  | "blocked"
  | "locking"
  | "locked"
  | "lock-failed"
  | "lock-blocked";

const MESSAGES: Record<Exclude<Step, "idle" | "written">, StringKey> = {
  writing: "equipment.nfc_ready",
  failed: "equipment.nfc_write_failed",
  blocked: "equipment.nfc_blocked",
  locking: "equipment.nfc_hold",
  locked: "equipment.nfc_locked",
  "lock-failed": "equipment.nfc_failed",
  "lock-blocked": "equipment.nfc_blocked",
};

const permissionRefused = (error: unknown): boolean => (error as Error).name === "NotAllowedError";

/** Starts writing as it opens. Chrome asks for NFC permission only while the click that opened the
 * window still counts as the person's own act, so the first write starts in the update that opens it. */
@customElement("dashboard-equipment-nfc-sticker")
export class EquipmentNfcSticker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .message {
        display: flex;
        align-items: start;
        gap: var(--wt-space-2);
        margin: 0;
        color: var(--wt-color-text);
      }
      .message wt-icon {
        flex: none;
      }
      .hint {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-text-muted);
      }
      .lock {
        --wt-action-text: var(--wt-color-danger);
      }
      @media (max-width: 360px) {
        wt-form-actions {
          --wt-button-padding-inline: var(--wt-space-1);
        }
      }
    `,
  ];

  @property() kind: EquipmentKind = "printer";
  @property() itemId = "";
  @property() name = "";
  /** Where focus returns when the window closes. */
  @property({ attribute: false }) opener: HTMLElement | null = null;

  @state() private step: Step = "idle";
  @state() private confirmLock = false;
  #operation: AbortController | undefined;
  #scan: AbortController | undefined;

  #reset(): void {
    this.#operation?.abort();
    this.#operation = undefined;
    this.#scan?.abort();
    this.#scan = undefined;
    this.step = "idle";
    this.confirmLock = false;
  }

  override disconnectedCallback(): void {
    this.#reset();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("kind") || changed.has("itemId")) {
      this.#reset();
      if (this.itemId !== "") void this.#write();
    }
  }

  /** Android opens its own tag viewer over the page for a sticker it finds while no page is
   * scanning, so this scan, whose readings nothing uses, stays open until the window closes. */
  async #keepScanning(Writer: new () => NfcWriter): Promise<void> {
    if (this.#scan !== undefined) return;
    const scan = new AbortController();
    this.#scan = scan;
    try {
      await new Writer().scan({ signal: scan.signal });
    } catch {
      if (this.#scan === scan) this.#scan = undefined;
    }
  }

  async #run(
    waiting: Step,
    act: (writer: NfcWriter, signal: AbortSignal) => Promise<void>,
    done: Step,
    failed: (error: unknown) => Step,
  ): Promise<void> {
    this.confirmLock = false;
    const Writer = nfcWriter()!;
    this.step = waiting;
    const controller = new AbortController();
    this.#operation = controller;
    void this.#keepScanning(Writer);
    let next = done;
    try {
      await act(new Writer(), controller.signal);
    } catch (error) {
      next = failed(error);
    }
    if (this.#operation !== controller) return;
    this.#operation = undefined;
    this.step = next;
  }

  async #write(): Promise<void> {
    if (this.#operation !== undefined || this.confirmLock) return;
    await this.#run(
      "writing",
      (writer, signal) =>
        writer.write(
          {
            records: [{ recordType: "text", data: formatEquipmentCode(this.kind, this.itemId) }],
          },
          { signal },
        ),
      "written",
      (error) => (permissionRefused(error) ? "blocked" : "failed"),
    );
  }

  async #lock(): Promise<void> {
    if (this.#operation !== undefined || !this.confirmLock) return;
    await this.#run(
      "locking",
      (writer, signal) => writer.makeReadOnly({ signal }),
      "locked",
      (error) => (permissionRefused(error) ? "lock-blocked" : "lock-failed"),
    );
  }

  /** The pressed button is gone while the phone waits for a sticker, so focus moves to Close. */
  async #writeAgain(): Promise<void> {
    const written = this.#write();
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>("[data-test=close-equipment-nfc]")?.focus();
    await written;
  }

  #close(): void {
    this.#reset();
    this.renderRoot.querySelector<WtModal>("wt-modal")!.open = false;
  }

  #message(): string {
    if (this.step === "idle") return "";
    if (this.step === "written")
      return t(
        this.kind === "printer" ? "equipment.nfc_written_printer" : "equipment.nfc_written_reader",
      );
    return t(MESSAGES[this.step]);
  }

  #actions(): TemplateResult | typeof nothing {
    if (this.step === "idle" || this.step === "writing" || this.step === "locking") return nothing;
    const again = this.step === "failed" || this.step === "blocked";
    const lockable =
      this.step === "written" || this.step === "lock-failed" || this.step === "lock-blocked";
    return html`${
        lockable
          ? html`<wt-button
              class="lock"
              data-test="lock-equipment-nfc"
              ?disabled=${this.confirmLock}
              @click=${() => {
                this.confirmLock = true;
              }}
              >${t("equipment.nfc_lock_dialog")}</wt-button
            >`
          : nothing
      }<wt-button
        variant=${this.confirmLock ? "secondary" : "primary"}
        data-test="write-equipment-nfc"
        ?disabled=${this.confirmLock}
        @click=${() => void this.#writeAgain()}
        >${t(again ? "equipment.try_again" : "equipment.nfc_write_another")}</wt-button
      >`;
  }

  override render(): TemplateResult {
    return html`<wt-modal
        size="compact"
        data-test="equipment-nfc-modal"
        heading=${fill("equipment.nfc_sticker_title", { name: this.name })}
        .open=${true}
        .opener=${this.opener}
        @wt-close=${() => this.#reset()}
      >
        <p class="message" role="status" data-test="equipment-nfc-message">
          ${
            this.step === "written"
              ? html`<wt-icon name="menu-check" size="lg"></wt-icon>`
              : nothing
          }<span>${this.#message()}</span>
        </p>
        ${
          this.step === "written"
            ? html`<p class="hint" data-test="equipment-nfc-lock-hint">
                ${t("equipment.nfc_lock_hint")}
              </p>`
            : nothing
        }
        <wt-form-actions slot="footer">
          <wt-button slot="cancel" data-test="close-equipment-nfc" @click=${() => this.#close()}
            >${t("action.close")}</wt-button
          >
          ${this.#actions()}
        </wt-form-actions>
      </wt-modal>
      <wt-dialog
        data-test="lock-equipment-nfc-confirmation"
        heading=${t("equipment.nfc_lock")}
        .open=${this.confirmLock}
        .opener=${this.renderRoot.querySelector<HTMLElement>("[data-test=close-equipment-nfc]")}
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
            @click=${() => void this.#lock()}
            >${t("equipment.nfc_lock")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-equipment-nfc-sticker": EquipmentNfcSticker;
  }
}
