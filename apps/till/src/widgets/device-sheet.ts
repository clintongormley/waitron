import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles, type ComboboxOption, type WtRowActions } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "./equipment-scanner.js";
import "./quiet-pay.js";
import { equipmentTakeover, listedRole } from "./equipment-dialog.js";
import { optionLabel } from "./equipment-labels.js";
import { type PayNotice, printerWarning } from "./pay-equipment.js";
import { t } from "../i18n/t.js";
import type {
  DeviceEquipment,
  EquipmentItem,
  EquipmentRole,
  RoleEquipment,
} from "../api/device-session-api.js";
import type { CapabilityFlag } from "../layout.js";
import type { EquipmentCode } from "../state/equipment-nfc.js";
import { type FixedReader, payPrinterOf, payReaderOf } from "../state/pay-equipment.js";

/** A choice made in the sheet. A scanned sticker names its kind; the server picks its roles, and
 * `role` is the one the app counts it against. */
export type DeviceSheetPick =
  | { role: EquipmentRole; id: string; takeOver: boolean; via: "list" }
  | {
      role: "card_terminal" | "receipt";
      kind: EquipmentCode["kind"];
      id: string;
      takeOver: false;
      via: "scan";
    };

type SheetRole = "card_terminal" | "receipt" | "payment_slip" | "cash_drawer";

const ROWS: { role: SheetRole; name: string; needs: CapabilityFlag | null }[] = [
  { role: "card_terminal", name: "cardReaderId", needs: null },
  { role: "receipt", name: "receiptPrinterId", needs: "print-receipt" },
  { role: "payment_slip", name: "paymentSlipPrinterId", needs: "print-receipt" },
  { role: "cash_drawer", name: "cashDrawerPrinterId", needs: null },
];

/**
 * Pay's device button and the sheet it opens: a camera that keeps scanning stickers, and one
 * dropdown per device this payment uses. It only shows and asks; the app sends every pick.
 */
@customElement("till-device-sheet")
export class TillDeviceSheet extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
      }

      wt-row-actions::part(trigger) {
        box-sizing: border-box;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }

      wt-row-actions[data-open]::part(trigger) {
        background: var(--wt-color-surface-lifted);
      }

      wt-row-actions::part(sheet) {
        min-height: calc(100dvh - var(--wt-tap-min) - 2 * var(--wt-space-3));
        background: var(--wt-color-surface);
      }

      .badge {
        width: var(--wt-space-3);
        height: var(--wt-space-3);
        border: 2px solid var(--wt-color-surface);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-warning);
      }

      .content {
        display: flex;
        flex: 1;
        flex-direction: column;
        color: var(--wt-color-text);
      }

      till-equipment-scanner {
        margin: calc(var(--wt-space-1) + var(--wt-space-1) / 2) var(--wt-space-4) 0;
      }

      .hint {
        margin: 0;
        padding: var(--wt-space-2) calc(var(--wt-space-4) + var(--wt-space-1)) var(--wt-space-1);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .allow {
        align-self: start;
        margin-inline: var(--wt-space-3);
      }

      .notice {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin: var(--wt-space-2) var(--wt-space-4) 0;
        padding: calc(var(--wt-space-2) + var(--wt-space-1) / 2)
          calc(var(--wt-space-3) + var(--wt-space-1) / 2);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-tab-ready-tint);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }

      .notice wt-icon {
        flex: none;
        color: var(--wt-color-success);
      }

      .notice.error {
        border: 1px solid var(--wt-color-danger);
        background: var(--wt-color-surface);
        color: var(--wt-color-danger);
      }

      .reason {
        margin: var(--wt-space-2) var(--wt-space-4) 0;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-warning);
        border-radius: var(--wt-radius-md);
        overflow-wrap: anywhere;
      }

      .reason p {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
      }

      .reason .reason-hint {
        margin-top: var(--wt-space-1);
        font-weight: var(--wt-font-weight-normal);
      }

      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        padding: var(--wt-space-2) var(--wt-space-4) 0;
      }

      .note {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .warning {
        margin: var(--wt-space-1) 0 0;
        padding-inline-start: var(--wt-space-2);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
        font-size: var(--wt-font-size-sm);
        overflow-wrap: anywhere;
      }

      .done {
        --done-height: calc(var(--wt-tap-min) + var(--wt-space-2));
        margin-block-start: auto;
        padding: var(--wt-space-2) var(--wt-space-4) var(--wt-space-5);
      }

      .done wt-button {
        width: 100%;
        --wt-tap-min: var(--done-height);
        --wt-action-font-size: var(--wt-font-size-lg);
      }
    `,
  ];

  /** As the server last said; `null` before it has been read. */
  @property({ attribute: false }) equipment: DeviceEquipment | null = null;
  /** The device profile's flags: the drawer row needs `open-cash-drawer`, the receipt and slip
   * rows `print-receipt`. */
  @property({ attribute: false }) capabilities: readonly CapabilityFlag[] = [];
  /** Money is moving: nothing in the sheet may change, and an open sheet closes. */
  @property({ type: Boolean }) disabled = false;
  /** A card is the payment method, so the reader is required. */
  @property({ type: Boolean }) cardRequired = false;
  /** A printer cannot print the receipt now; marks the button. */
  @property({ type: Boolean }) badge = false;
  /** The latest pick being saved, shown under its field. */
  @property({ attribute: false }) saving: { role: EquipmentRole; id: string } | null = null;
  /** Why a pick was refused, under the field it was made in. */
  @property({ attribute: false }) errors: Partial<Record<EquipmentRole, string>> = {};
  /** What the latest sticker did, in the hint's place. */
  @property({ attribute: false }) notice: PayNotice | null = null;
  /** `null` where the browser has no NFC. */
  @property({ attribute: false }) nfcPermission: PermissionState | null = null;
  /** NFC failed to start in this page, so the hint no longer offers it. */
  @property({ type: Boolean }) nfcUnavailable = false;
  /** Why the phone no longer has the reader it had, and what to do about it. */
  @property({ attribute: false }) readerReason: string | null = null;
  @property({ attribute: false }) readerHint: string | null = null;
  /** A practice payment's reader: shown, never chosen. */
  @property({ attribute: false }) fixedReader: FixedReader | null = null;
  @state() private open = false;
  @state() private asking: { role: EquipmentRole; item: EquipmentItem } | null = null;
  @state() private highlighted: ReadonlySet<EquipmentRole> = new Set();
  @query("wt-row-actions") private sheet!: WtRowActions;
  /** The equipment when the latest scan was sent; its answer is compared with it. */
  #beforeScan: DeviceEquipment | null | undefined;

  show(): void {
    this.sheet?.show();
  }

  hide(): void {
    this.sheet?.hide({ restoreFocus: true });
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("equipment") && this.#beforeScan !== undefined && this.equipment !== null) {
      const before = this.#beforeScan;
      const after = this.equipment;
      if (after !== before) {
        this.#beforeScan = undefined;
        this.highlighted = new Set(
          after.roles
            .filter(
              (role) =>
                before?.roles.find((each) => each.role === role.role)?.resolved?.id !==
                role.resolved?.id,
            )
            .map((role) => role.role),
        );
      }
    }
  }

  #emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
  }

  #toggled(event: CustomEvent<{ open: boolean }>): void {
    this.open = event.detail.open;
    if (this.open) return;
    this.asking = null;
    this.highlighted = new Set();
    this.#beforeScan = undefined;
  }

  #scanned(event: CustomEvent<EquipmentCode>): void {
    event.stopPropagation();
    const { kind, id } = event.detail;
    this.#beforeScan = this.equipment;
    this.#emit<DeviceSheetPick>("device-sheet-pick", {
      role: kind === "reader" ? "card_terminal" : "receipt",
      kind,
      id,
      takeOver: false,
      via: "scan",
    });
  }

  #pickFromList(role: EquipmentRole, id: string, takeOver: boolean): void {
    this.highlighted = new Set();
    this.#beforeScan = undefined;
    this.#emit<DeviceSheetPick>("device-sheet-pick", { role, id, takeOver, via: "list" });
  }

  #onPick(role: RoleEquipment, shown: string, value: string): void {
    if (this.asking?.role === role.role) this.asking = null;
    if (value === "" || value === shown) return;
    const picked = role.choices.find((choice) => choice.id === value);
    if (picked?.heldBy && !picked.busy) {
      this.asking = { role: role.role, item: picked };
      return;
    }
    this.#pickFromList(role.role, value, false);
  }

  #shown(role: RoleEquipment): { id: string; name: string } | null {
    if (role.role === "card_terminal") {
      const reader = payReaderOf(this.equipment);
      return reader.kind === "ready" ? reader : null;
    }
    if (role.role === "receipt") {
      const printer = payPrinterOf(this.equipment);
      return printer.kind === "ready" ? printer : null;
    }
    return role.resolved;
  }

  #field(row: (typeof ROWS)[number], role: RoleEquipment): TemplateResult {
    const label = t(`equipment.${row.role}`);
    const fixed = row.role === "card_terminal" ? this.fixedReader : null;
    if (fixed !== null)
      return html`<wt-combobox
        variant="boxed"
        name=${row.name}
        search="never"
        label=${label}
        disabled
        .options=${[{ value: fixed.id ?? "", label: fixed.name }]}
        .value=${fixed.id ?? ""}
      ></wt-combobox>`;
    const shown = this.#shown(role);
    const saving = this.saving?.role === row.role ? this.saving : null;
    const value = saving?.id ?? shown?.id ?? "";
    const options: ComboboxOption[] = role.choices.map((choice) => ({
      value: choice.id,
      label: optionLabel(choice),
      ...(choice.busy ? { disabled: true } : {}),
    }));
    if (shown !== null && !role.choices.some((choice) => choice.id === shown.id))
      options.unshift({ value: shown.id, fixed: true, label: shown.name });
    const note = saving === null ? "" : t("pay_equipment.saving");
    const error = this.errors[row.role] ?? "";
    const warning = row.role === "receipt" ? printerWarning(payPrinterOf(this.equipment)) : null;
    const placeholder =
      row.role === "card_terminal"
        ? t("pay_equipment.reader_placeholder")
        : row.role === "cash_drawer"
          ? t("device_sheet.drawer_placeholder")
          : t("pay_equipment.printer_placeholder");
    // wt-combobox draws its hint for screen readers only; the note under the field is what is seen.
    return html`<div data-device-sheet-row=${row.role}>
      <wt-combobox
        variant="boxed"
        name=${row.name}
        search="never"
        label=${label}
        placeholder=${placeholder}
        ?required=${row.role === "card_terminal" && this.cardRequired}
        ?disabled=${this.disabled}
        ?highlight=${this.highlighted.has(row.role)}
        .options=${options}
        .value=${live(value)}
        .hint=${note}
        .error=${error}
        .invalid=${error !== ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.#onPick(role, value, event.detail.value);
          this.requestUpdate();
        }}
      ></wt-combobox
      >${note === "" ? nothing : html`<p class="note" aria-hidden="true" data-pay-note=${row.role}>${note}</p>`}${
        warning === null
          ? nothing
          : html`<p class="warning" role="status" data-pay-printer-warning>${warning}</p>`
      }
    </div>`;
  }

  #fields(): TemplateResult[] {
    return ROWS.flatMap((row) => {
      if (row.needs !== null && !this.capabilities.includes(row.needs)) return [];
      const role = listedRole(this.equipment, row.role, this.capabilities);
      return role === undefined ? [] : [this.#field(row, role)];
    });
  }

  #hint(): TemplateResult {
    const notice = this.notice;
    // Two templates, so a change of tone puts in a new live region rather than retyping one.
    if (notice !== null)
      return notice.tone === "error"
        ? html`<p class="notice error" role="alert" data-device-sheet-notice>${notice.message}</p>`
        : html`<p class="notice" role="status" data-device-sheet-notice>
            <wt-icon name="check" aria-hidden="true"></wt-icon>${notice.message}
          </p>`;
    const nfc = this.nfcPermission !== null && !this.nfcUnavailable;
    return html`<p class="hint" data-device-sheet-hint>
        ${t("device_sheet.hint")}${nfc ? ` ${t("device_sheet.hint_nfc")}` : ""}
      </p>
      ${
        nfc && this.nfcPermission === "prompt"
          ? html`<wt-button
              class="allow"
              variant="ghost"
              data-pay-nfc
              ?disabled=${this.disabled}
              @click=${() => this.#emit("device-sheet-nfc", {})}
              >${t("equipment.nfc_allow")}</wt-button
            >`
          : nothing
      }`;
  }

  #reason(): TemplateResult | typeof nothing {
    if (this.readerReason === null) return nothing;
    return html`<div class="reason" role="status" data-pay-reader-reason>
      <p data-pay-reader-line>${this.readerReason}</p>
      ${
        this.readerHint === null
          ? nothing
          : html`<p class="reason-hint" data-pay-reader-hint>${this.readerHint}</p>`
      }
    </div>`;
  }

  #asking(): TemplateResult | typeof nothing {
    const asking = this.asking;
    if (asking === null) return nothing;
    return equipmentTakeover(
      asking.item,
      () => {
        this.asking = null;
        this.#pickFromList(asking.role, asking.item.id, true);
      },
      () => (this.asking = null),
    );
  }

  override render() {
    const filming = this.open && !this.disabled;
    return html`<wt-row-actions
      icon="pay-contactless"
      panel
      bottom-sheet
      sheet-variant="menu"
      focus-sheet
      label=${t(this.badge ? "device_sheet.label_problem" : "device_sheet.label")}
      sheet-label=${t("device_sheet.label")}
      ?data-open=${this.open}
      ?disabled=${this.disabled}
      @wt-row-actions-toggle=${this.#toggled}
    >
      ${this.badge ? html`<span slot="badge" class="badge" data-device-sheet-badge></span>` : nothing}
      <div class="content" data-keep-open>
        ${
          filming
            ? html`<till-equipment-scanner
                kind="any"
                framed
                keep-going
                .caption=${t("device_sheet.caption")}
                @equipment-scanned=${this.#scanned}
              ></till-equipment-scanner>`
            : nothing
        }
        ${this.#hint()} ${this.#reason()}
        <div class="fields">${this.#fields()}</div>
        ${this.#asking()}
        <div class="done">
          <wt-button variant="primary" data-device-sheet-done @click=${() => this.hide()}
            >${t("device_sheet.done")}</wt-button
          >
        </div>
      </div>
    </wt-row-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-device-sheet": TillDeviceSheet;
  }
}
