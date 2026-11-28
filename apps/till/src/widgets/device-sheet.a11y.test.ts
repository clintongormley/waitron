import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtCombobox } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cameraShowing } from "@waitron/ui/test/qr-camera.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget, type Theme } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./device-sheet.js";
import type { TillDeviceSheet } from "./device-sheet.js";
import type { DeviceEquipment } from "../api/device-session-api.js";
import { equipmentItem, roleOf } from "../../test/pay-equipment-fixtures.js";

const R2 = equipmentItem("r2", "Reader 2", { portable: true, provider: "sumup" });
const R3 = equipmentItem("r3", "Reader 3", {
  portable: true,
  provider: "sumup",
  heldBy: { deviceId: "d2", deviceName: "Phone 2", personName: "Marc" },
});
const BAR = equipmentItem("p1", "Bar");
const DRAWER = equipmentItem("p3", "Counter drawer");

const equipment: DeviceEquipment = {
  roles: [
    roleOf("receipt", BAR, [BAR]),
    roleOf("payment_slip", BAR, [BAR]),
    roleOf("cash_drawer", DRAWER, [DRAWER]),
    roleOf("invoice", null, []),
    roleOf("card_terminal", R2, [R2, R3]),
  ],
};

let camera: ReturnType<typeof cameraShowing> | undefined;
const [width, height] = [innerWidth, innerHeight];

beforeEach(async () => {
  setLocale("en");
  await page.viewport(390, 844);
});
afterEach(async () => {
  cleanupWidgets();
  camera?.stop();
  camera = undefined;
  vi.restoreAllMocks();
  await page.viewport(width, height);
});

async function opened(theme: Theme, props: Partial<TillDeviceSheet> = {}) {
  const mounted = await mountWidget<TillDeviceSheet>(
    "till-device-sheet",
    { equipment, capabilities: ["print-receipt"], nfcPermission: "prompt", ...props },
    theme,
  );
  mounted.el.show();
  await mounted.el.updateComplete;
  return mounted;
}

describe.each(["light", "dark"] as const)("till-device-sheet a11y (%s theme)", (theme) => {
  it("r 1, filming, has no violations", async () => {
    camera = cameraShowing(null);
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(camera.stream);
    const { el, host } = await opened(theme);
    const video = () => el.shadowRoot!.querySelector("till-equipment-scanner")!.shadowRoot!;
    await expect.poll(() => video().querySelector("video")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("r 2, after a scan, with the drawer and a printer problem, has no violations", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const { host } = await opened(theme, {
      capabilities: ["print-receipt", "open-cash-drawer"],
      notice: { message: "Picked up Reader 2", tone: "info" },
      badge: true,
    });
    await expectNoA11yViolations(host);
  });

  it("an error notice, a lost reader and a refusal under Card reader have no violations", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const { host } = await opened(theme, {
      notice: { message: "That sticker is not on this device's list", tone: "error" },
      readerReason: "Phone 2 (Marc) took Reader 2",
      readerHint: "Choose the reader in your hand.",
      errors: { card_terminal: "That reader is busy" },
      saving: { role: "receipt", id: "p1" },
    });
    await expectNoA11yViolations(host);
  });

  it("Take it? has no violations", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const { el, host } = await opened(theme);
    await chooseOption(el.shadowRoot!.querySelector<WtCombobox>('[name="cardReaderId"]')!, "r3");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-equipment-confirm]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("with no camera, and the trigger closed and disabled, has no violations", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    try {
      const { el, host } = await opened(theme);
      await expectNoA11yViolations(host);
      el.disabled = true;
      await el.updateComplete;
      await expectNoA11yViolations(host);
    } finally {
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });
});
