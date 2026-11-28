import { html, type TemplateResult } from "lit";
import type { WtRowActions } from "@waitron/ui";
import "./device-sheet.js";
import type { DeviceSheetPick, TillDeviceSheet } from "./device-sheet.js";
import { type PayEquipmentPick, type PayNotice, printerWarning } from "./pay-equipment.js";
import type { DeviceEquipment, EquipmentRole } from "../api/device-session-api.js";
import type { CapabilityFlag } from "../layout.js";
import type { EquipmentCode } from "../state/equipment-nfc.js";
import { type FixedReader, payPrinterOf } from "../state/pay-equipment.js";

/** The pay dialog's inputs the sheet shows, as the app passes them. */
export interface PayDeviceSheetHost extends HTMLElement {
  readonly equipment: DeviceEquipment | null;
  readonly capabilities: readonly CapabilityFlag[];
  readonly equipmentSaving: { role: EquipmentRole; id: string } | null;
  readonly equipmentErrors: Partial<Record<EquipmentRole, string>>;
  readonly notice: PayNotice | null;
  readonly nfcPermission: PermissionState | null;
  readonly nfcUnavailable: boolean;
  readonly readerReason: string | null;
  readonly readerHint: string | null;
  readonly fixedReader: FixedReader | null;
}

function emit<T>(host: HTMLElement, type: string, detail: T): void {
  host.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
}

/**
 * A phone's device button on Pay. Its picks leave `host` as the folded row's events, so the app
 * sends them the same way: a list pick as `pay-equipment-pick`, a sticker as `pay-equipment-sticker`.
 */
export function payDeviceSheet(
  host: PayDeviceSheetHost,
  cardRequired: boolean,
  disabled: boolean,
  toggled: (open: boolean) => void,
): TemplateResult {
  const badge =
    host.capabilities.includes("print-receipt") &&
    printerWarning(payPrinterOf(host.equipment)) !== null;
  return html`<till-device-sheet
    slot="action"
    .equipment=${host.equipment}
    .capabilities=${host.capabilities}
    .disabled=${disabled}
    .cardRequired=${cardRequired}
    .badge=${badge}
    .saving=${host.equipmentSaving}
    .errors=${host.equipmentErrors}
    .notice=${host.notice}
    .nfcPermission=${host.nfcPermission}
    .nfcUnavailable=${host.nfcUnavailable}
    .readerReason=${host.readerReason}
    .readerHint=${host.readerHint}
    .fixedReader=${host.fixedReader}
    @wt-row-actions-toggle=${(event: CustomEvent<{ open: boolean }>) => toggled(event.detail.open)}
    @device-sheet-nfc=${(event: Event) => {
      event.stopPropagation();
      emit(host, "pay-equipment-nfc", {});
    }}
    @device-sheet-pick=${(event: CustomEvent<DeviceSheetPick>) => {
      event.stopPropagation();
      const pick = event.detail;
      if (pick.via === "scan")
        emit<EquipmentCode>(host, "pay-equipment-sticker", { kind: pick.kind, id: pick.id });
      else
        emit<PayEquipmentPick>(host, "pay-equipment-pick", {
          role: pick.role,
          id: pick.id,
          takeOver: pick.takeOver,
        });
    }}
  ></till-device-sheet>`;
}

/** Opens the sheet in `root` once it has drawn; a disabled sheet stays shut. */
export async function showPayDeviceSheet(root: ParentNode): Promise<void> {
  const sheet = root.querySelector<TillDeviceSheet>("till-device-sheet");
  if (sheet === null) return;
  await sheet.updateComplete;
  await sheet.shadowRoot?.querySelector<WtRowActions>("wt-row-actions")?.updateComplete;
  sheet.show();
}
