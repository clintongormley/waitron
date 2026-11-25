import { html, nothing, type TemplateResult } from "lit";
import type { EquipmentKind } from "@waitron/shared";
import type { DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import { nfcWriter } from "./equipment-nfc-sticker.js";
import "./equipment-qr-label.js";

export type EquipmentLabelWindow = "qr" | "nfc";

/** The row-menu actions that label one piece of equipment, for the screen to put in its own menu.
 * `open` gets the window to show and the menu's button, where focus returns. */
export function equipmentLabelItems(
  id: string,
  open: (window: EquipmentLabelWindow, opener: HTMLElement) => void,
): TemplateResult {
  const press = (window: EquipmentLabelWindow) => (event: Event) => {
    const item = event.currentTarget as HTMLElement;
    const menu = item.closest("wt-row-actions, dashboard-row-actions");
    open(window, menu?.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? item);
  };
  return html`<wt-button
      icon="menu-equipment-label"
      data-test=${`qr-label-${id}`}
      @click=${press("qr")}
      >${t("equipment.qr_label_dialog")}</wt-button
    >${
      nfcWriter() === undefined
        ? nothing
        : html`<wt-button
            icon="menu-nfc-sticker"
            data-test=${`nfc-sticker-${id}`}
            @click=${press("nfc")}
            >${t("equipment.nfc_sticker_dialog")}</wt-button
          >`
    }`;
}

export function equipmentLabelWindow(
  window: EquipmentLabelWindow,
  equipment: {
    kind: EquipmentKind;
    item: { id: string; name: string };
    api: DashboardApi;
    opener: HTMLElement | null;
    close: () => void;
  },
): TemplateResult {
  return window === "qr"
    ? html`<dashboard-equipment-qr-label
        .api=${equipment.api}
        .kind=${equipment.kind}
        .itemId=${equipment.item.id}
        .name=${equipment.item.name}
        .opener=${equipment.opener}
        @wt-close=${equipment.close}
      ></dashboard-equipment-qr-label>`
    : html`<dashboard-equipment-nfc-sticker
        .kind=${equipment.kind}
        .itemId=${equipment.item.id}
        .name=${equipment.item.name}
        .opener=${equipment.opener}
        @wt-close=${equipment.close}
      ></dashboard-equipment-nfc-sticker>`;
}
