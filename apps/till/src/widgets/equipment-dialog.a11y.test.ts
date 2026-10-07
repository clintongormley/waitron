import { afterEach, describe, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { WtCombobox } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./equipment-dialog.js";
import type { TillEquipmentDialog } from "./equipment-dialog.js";
import type { DeviceEquipment, EquipmentItem, RoleEquipment } from "../api/client.js";

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
});

function item(id: string, name: string, extra: Partial<EquipmentItem> = {}): EquipmentItem {
  return { id, name, portable: false, available: true, busy: false, heldBy: null, ...extra };
}

const BAR = { deviceId: "dev-bar", deviceName: "Barra", personName: "Ana" };
const P1 = item("P1", "Impresora de mostrador");
const PP = item("PP", "Impresora portátil", { portable: true, heldBy: BAR });
const OFF = item("P2", "Impresora de barra", { available: false });
const R1 = item("R1", "Lector uno", { portable: true });
const R2 = item("R2", "Lector dos", { portable: true, busy: true });
const D1 = item("D1", "Cajón de mostrador");

function role(
  name: RoleEquipment["role"],
  chosen: EquipmentItem | null,
  fallback: EquipmentItem | null,
  choices: EquipmentItem[],
): RoleEquipment {
  const shown = chosen ?? fallback;
  return {
    role: name,
    selection: chosen === null ? "default" : "item",
    chosenId: chosen?.id ?? null,
    resolved:
      shown === null || shown.heldBy !== null
        ? null
        : { id: shown.id, name: shown.name, available: shown.available },
    chosen,
    default: fallback,
    choices,
  };
}

const EVERY_ROW: DeviceEquipment = {
  roles: [
    role("receipt", OFF, P1, [P1]),
    role("payment_slip", null, PP, [P1, PP]),
    role("cash_drawer", null, null, [D1]),
    role("card_terminal", null, R1, [R1, R2]),
  ],
};

const NOTHING_CHOSEN: DeviceEquipment = {
  roles: [
    role("receipt", null, null, [P1]),
    role("payment_slip", null, null, []),
    role("cash_drawer", null, null, []),
    role("card_terminal", null, null, [R1]),
  ],
};

type Setup = (el: TillEquipmentDialog) => Promise<void>;

const STATES: [string, Partial<TillEquipmentDialog>, Setup?][] = [
  [
    "all four rows: a switched-off choice, a held default, None and a busy reader",
    { equipment: EVERY_ROW },
  ],
  ["only None", { equipment: NOTHING_CHOSEN }],
  [
    "a refusal under the reader",
    { equipment: EVERY_ROW, error: { code: "reader.payment_in_progress" } },
  ],
  [
    "a refusal naming no field it shows",
    { equipment: EVERY_ROW, error: { code: "server.internal" } },
  ],
  [
    "the takeover question",
    { equipment: EVERY_ROW },
    async (el) => {
      await chooseOption(
        el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="paymentSlipPrinterId"]')!,
        "PP",
      );
      await el.updateComplete;
    },
  ],
  [
    "the scanner with the camera refused",
    { equipment: EVERY_ROW },
    async (el) => {
      vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
        new DOMException("Permission denied", "NotAllowedError"),
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-scan]")!.click();
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.shadowRoot!.querySelector("till-equipment-scanner")!.updateComplete;
    },
  ],
];

describe.each(["light", "dark"] as const)("till-equipment-dialog a11y (%s theme)", (theme) => {
  it.each(STATES)("has no violations with %s", async (_name, props, setup) => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillEquipmentDialog>(
      "till-equipment-dialog",
      { open: true, ...props },
      theme,
    );
    await setup?.(el);
    await expectNoA11yViolations(host);
  });
});
