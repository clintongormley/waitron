import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import {
  baseStyles,
  DROPDOWN_ICONS,
  registerIcons,
  type ComboboxOption,
  type WtRowActions,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "./equipment-scanner.js";
import { equipmentTakeover, listedRole } from "./equipment-dialog.js";
import { optionLabel } from "./equipment-labels.js";
import { type PayNotice, payNotice, payNoticeStyles, printerWarning } from "./pay-equipment.js";
import { PAY_CONTACTLESS_ICON } from "./quiet-pay.js";
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

registerIcons({ ...DROPDOWN_ICONS, "pay-contactless": PAY_CONTACTLESS_ICON });

/** A choice made in the sheet. A scanned sticker names its kind; the server picks its roles. */
export type DeviceSheetPick =
  | { role: EquipmentRole; id: string; takeOver: boolean; via: "list" }
  | { kind: EquipmentCode["kind"]; id: string; via: "scan" };

type SheetRole = "card_terminal" | "receipt" | "payment_slip" | "cash_drawer";

/** Each row's flag is the one that offers what the row serves: Charge, a printed receipt or slip,
 * the drawer. */
const ROWS: { role: SheetRole; name: string; needs: CapabilityFlag }[] = [
  { role: "card_terminal", name: "cardReaderId", needs: "integrated-card-payment" },
  { role: "receipt", name: "receiptPrinterId", needs: "print-receipt" },
  { role: "payment_slip", name: "paymentSlipPrinterId", needs: "print-receipt" },
  { role: "cash_drawer", name: "cashDrawerPrinterId", needs: "open-cash-drawer" },
];

function changedRoles(
  before: DeviceEquipment | null | undefined,
  after: DeviceEquipment | null,
): Set<EquipmentRole> {
  return new Set(
    (after?.roles ?? [])
      .filter(
        (role) =>
          before?.roles.find((each) => each.role === role.role)?.resolved?.id !== role.resolved?.id,
      )
      .map((role) => role.role),
  );
}

/**
 * Pay's device button and the sheet it opens: a camera that keeps scanning stickers, and one
 * dropdown per device this payment uses. It only shows and asks; the app sends every pick.
 */
@customElement("till-device-sheet")
export class TillDeviceSheet extends LitElement {
  static override styles = [
    baseStyles,
    payNoticeStyles,
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
        --wt-font-size-md: calc(var(--wt-space-4) + var(--wt-space-1));
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

      .pay-notice {
        margin: var(--wt-space-2) var(--wt-space-4) 0;
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
  /** The device profile's flags, which choose the rows. */
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

  show(): void {
    this.sheet?.show();
  }

  hide(): void {
    this.sheet?.hide({ restoreFocus: true });
  }

  /** The app sets a sticker's notice in the same turn as the equipment its answer stored, so each
   * notice is compared with the equipment shown just before it: scans answered one after another
   * each light what their own answer changed. */
  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("notice") || this.notice === null || !this.open) return;
    this.highlighted =
      this.notice.tone === "info" && changed.has("equipment")
        ? changedRoles(changed.get("equipment"), this.equipment)
        : new Set();
  }

  #emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
  }

  #toggled(event: CustomEvent<{ open: boolean }>): void {
    event.stopPropagation();
    this.open = event.detail.open;
    this.#emit("device-sheet-toggle", { open: this.open });
    if (this.open) return;
    this.asking = null;
    this.highlighted = new Set();
  }

  #scanned(event: CustomEvent<EquipmentCode>): void {
    event.stopPropagation();
    const { kind, id } = event.detail;
    this.#emit<DeviceSheetPick>("device-sheet-pick", { kind, id, via: "scan" });
  }

  #pickFromList(role: EquipmentRole, id: string, takeOver: boolean): void {
    this.highlighted = new Set();
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
      if (!this.capabilities.includes(row.needs)) return [];
      const role =
        listedRole(this.equipment, row.role, this.capabilities) ?? this.#unlisted(row.role);
      return role === undefined ? [] : [this.#field(row, role)];
    });
  }

  /** A row with nothing listed stays while it holds a refusal, which would otherwise vanish, or a
   * practice payment's fixed reader. */
  #unlisted(role: SheetRole): RoleEquipment | undefined {
    const kept =
      (this.errors[role] ?? "") !== "" || (role === "card_terminal" && this.fixedReader !== null);
    if (!kept) return undefined;
    return {
      role,
      selection: "default",
      chosenId: null,
      resolved: null,
      chosen: null,
      default: null,
      choices: [],
    };
  }

  #hint(): TemplateResult {
    const notice = this.notice;
    const nfc = this.nfcPermission !== null && !this.nfcUnavailable;
    const line =
      notice === null
        ? html`<p class="hint" data-device-sheet-hint>
            ${t("device_sheet.hint")}${nfc ? ` ${t("device_sheet.hint_nfc")}` : ""}
          </p>`
        : payNotice(notice);
    return html`${line}
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
    if (this.readerReason === null || !this.capabilities.includes("integrated-card-payment"))
      return nothing;
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
