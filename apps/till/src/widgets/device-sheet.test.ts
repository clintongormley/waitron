import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtCombobox, WtRowActions } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cameraShowing } from "@waitron/ui/test/qr-camera.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./device-sheet.js";
import type { DeviceSheetPick, TillDeviceSheet } from "./device-sheet.js";
import type { DeviceEquipment, EquipmentItem } from "../api/device-session-api.js";
import type { CapabilityFlag } from "../layout.js";
import { equipmentItem, roleOf } from "../../test/pay-equipment-fixtures.js";

const R2 = equipmentItem("r2", "Reader 2", { portable: true, provider: "sumup" });
const R3 = equipmentItem("r3", "Reader 3", { portable: true, provider: "sumup" });
const BUSY = equipmentItem("r4", "Reader 4", { portable: true, provider: "sumup", busy: true });
const HELD = equipmentItem("r5", "Reader 5", {
  portable: true,
  provider: "sumup",
  heldBy: { deviceId: "d2", deviceName: "Phone 2", personName: null },
});
const BAR = equipmentItem("p1", "Bar");
const TERRACE = equipmentItem("p2", "Terrace");
const DRAWER = equipmentItem("p3", "Counter drawer");
const ALL: CapabilityFlag[] = ["print-receipt", "open-cash-drawer", "integrated-card-payment"];

function equipment(
  reader: EquipmentItem | null = R2,
  printer: EquipmentItem = BAR,
  slip: EquipmentItem = BAR,
): DeviceEquipment {
  return {
    roles: [
      roleOf("receipt", printer, [BAR, TERRACE]),
      roleOf("payment_slip", slip, [BAR, TERRACE]),
      roleOf("cash_drawer", DRAWER, [DRAWER]),
      roleOf("invoice", null, []),
      roleOf("card_terminal", reader, [R2, R3, BUSY, HELD]),
    ],
  };
}

let camera: ReturnType<typeof cameraShowing> | undefined;

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  camera?.stop();
  camera = undefined;
  vi.restoreAllMocks();
});

function film(): MediaStream {
  camera?.stop();
  camera = cameraShowing(null);
  vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(camera.stream);
  return camera.stream;
}

async function mountSheet(props: Partial<TillDeviceSheet> = {}) {
  const { el } = await mountWidget<TillDeviceSheet>("till-device-sheet", {
    equipment: equipment(),
    capabilities: ALL,
    ...props,
  });
  const picks: DeviceSheetPick[] = [];
  el.addEventListener("device-sheet-pick", (event) =>
    picks.push((event as CustomEvent<DeviceSheetPick>).detail),
  );
  return { el, picks };
}

const sheet = (el: TillDeviceSheet) =>
  el.shadowRoot!.querySelector<WtRowActions>("wt-row-actions")!;
const popup = (el: TillDeviceSheet) =>
  sheet(el).shadowRoot!.querySelector<HTMLElement>("[popover]")!;
const isOpen = (el: TillDeviceSheet) => popup(el).matches(":popover-open");
const scanner = (el: TillDeviceSheet) => el.shadowRoot!.querySelector("till-equipment-scanner");
const rows = (el: TillDeviceSheet) =>
  [...el.shadowRoot!.querySelectorAll<WtCombobox>("wt-combobox")].map((box) => box.name);
const box = (el: TillDeviceSheet, name: string) =>
  el.shadowRoot!.querySelector<WtCombobox>(`wt-combobox[name="${name}"]`)!;

async function open(el: TillDeviceSheet): Promise<void> {
  el.show();
  await el.updateComplete;
  await scanner(el)?.updateComplete;
}

describe("till-device-sheet", () => {
  it("films only while open, and stops the camera on Done, a tap outside, Escape and removal", async () => {
    const closers: ((el: TillDeviceSheet) => void | Promise<void>)[] = [
      (el) => el.shadowRoot!.querySelector<HTMLElement>("[data-device-sheet-done]")!.click(),
      (el) => popup(el).click(),
      () => userEvent.keyboard("{Escape}"),
      (el) => el.remove(),
    ];
    for (const close of closers) {
      const stream = film();
      const { el } = await mountSheet();
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
      expect(scanner(el)).toBeNull();

      await open(el);
      await expect.poll(() => stream.getTracks()[0]!.readyState).toBe("live");
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
      await close(el);

      await expect
        .poll(() => stream.getTracks().every((track) => track.readyState === "ended"))
        .toBe(true);
      expect(isOpen(el)).toBe(false);
      vi.restoreAllMocks();
    }
  });

  it("announces opening and closing as its own event, keeping the inner menu's inside", async () => {
    const { el } = await mountSheet();
    const heard: string[] = [];
    for (const type of ["device-sheet-toggle", "wt-row-actions-toggle"])
      el.addEventListener(type, (event) =>
        heard.push(`${type} ${(event as CustomEvent<{ open: boolean }>).detail.open}`),
      );

    await open(el);
    el.hide();
    await expect
      .poll(() => heard)
      .toEqual(["device-sheet-toggle true", "device-sheet-toggle false"]);
  });

  it("draws no camera box without camera access, only the unavailable line", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    try {
      const { el } = await mountSheet();
      await open(el);

      const root = scanner(el)!.shadowRoot!;
      expect(root.querySelector("[data-scanner-camera]")).toBeNull();
      expect(root.textContent).toContain(t("equipment.camera_unavailable"));
    } finally {
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });

  it("lists card reader, receipt, slip and drawer in that order, each by its flag", async () => {
    const all = await mountSheet();
    expect(rows(all.el)).toEqual([
      "cardReaderId",
      "receiptPrinterId",
      "paymentSlipPrinterId",
      "cashDrawerPrinterId",
    ]);
    const noDrawer = await mountSheet({
      capabilities: ["print-receipt", "integrated-card-payment"],
    });
    expect(rows(noDrawer.el)).toEqual(["cardReaderId", "receiptPrinterId", "paymentSlipPrinterId"]);
    const noReceipt = await mountSheet({
      capabilities: ["open-cash-drawer", "integrated-card-payment"],
    });
    expect(rows(noReceipt.el)).toEqual(["cardReaderId", "cashDrawerPrinterId"]);
    const noCard = await mountSheet({ capabilities: ["print-receipt", "open-cash-drawer"] });
    expect(rows(noCard.el)).toEqual([
      "receiptPrinterId",
      "paymentSlipPrinterId",
      "cashDrawerPrinterId",
    ]);
  });

  it("draws a practice payment's fixed reader with no reader listed", async () => {
    const { el } = await mountSheet({
      equipment: { roles: [roleOf("card_terminal", null, [])] },
      fixedReader: { name: "Simulator" },
    });
    expect(box(el, "cardReaderId").options.map((option) => option.label)).toEqual(["Simulator"]);
    expect(box(el, "cardReaderId").disabled).toBe(true);
  });

  it("draws a chevron on every dropdown, even with one choice, and the device icon on its button", async () => {
    const { el } = await mountSheet();
    const drawn = (icon: Element | null | undefined) =>
      icon?.shadowRoot?.querySelector("path")?.getAttribute("d") ?? "";
    for (const name of rows(el)) {
      await box(el, name).updateComplete;
      expect(drawn(box(el, name).shadowRoot!.querySelector(".chevron")), name).not.toBe("");
    }
    const trigger = sheet(el).shadowRoot!.querySelector('[part="trigger"] wt-icon');
    expect(drawn(trigger)).not.toBe("");
  });

  it("highlights every role a scan changed: a printer sticker picks up receipt and slip together", async () => {
    film();
    const { el, picks } = await mountSheet();
    await open(el);

    scanner(el)!.dispatchEvent(
      new CustomEvent("equipment-scanned", {
        detail: { kind: "printer", id: "p2" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(picks).toEqual([{ kind: "printer", id: "p2", via: "scan" }]);
    el.equipment = equipment(R2, TERRACE, TERRACE);
    el.notice = { message: "Picked up Terrace", tone: "info" };
    await el.updateComplete;

    const lit = (name: string) => box(el, name).highlight;
    expect([lit("cardReaderId"), lit("receiptPrinterId"), lit("paymentSlipPrinterId")]).toEqual([
      false,
      true,
      true,
    ]);
    expect(isOpen(el)).toBe(true);
    expect(scanner(el)).not.toBeNull();
  });

  it("highlights what each answer changed when two scans were sent before the first answer", async () => {
    film();
    const { el } = await mountSheet();
    await open(el);
    for (const detail of [
      { kind: "reader", id: "r3" },
      { kind: "printer", id: "p2" },
    ])
      scanner(el)!.dispatchEvent(new CustomEvent("equipment-scanned", { detail, bubbles: true }));
    const lit = () => rows(el).filter((name) => box(el, name).highlight);

    el.equipment = equipment(R3);
    el.notice = { message: "Picked up Reader 3", tone: "info" };
    await el.updateComplete;
    expect(lit()).toEqual(["cardReaderId"]);
    el.equipment = equipment(R3, TERRACE, TERRACE);
    el.notice = { message: "Picked up Terrace", tone: "info" };
    await el.updateComplete;
    expect(lit()).toEqual(["receiptPrinterId", "paymentSlipPrinterId"]);
  });

  it("sends a free pick at once, asks Take it? for a held one, and offers a busy reader unpickable", async () => {
    const { el, picks } = await mountSheet();
    await open(el);
    const reader = box(el, "cardReaderId");
    expect(reader.options.find((option) => option.value === "r4")?.disabled).toBe(true);

    await chooseOption(reader, "r3");
    await chooseOption(reader, "r5");
    await el.updateComplete;
    expect(picks).toEqual([{ role: "card_terminal", id: "r3", takeOver: false, via: "list" }]);
    const confirm = el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-confirm]")!;
    expect(confirm.closest("[data-keep-open]")).not.toBeNull();
    confirm.querySelector<HTMLElement>("[data-equipment-take]")!.click();
    await el.updateComplete;

    expect(picks.at(-1)).toEqual({ role: "card_terminal", id: "r5", takeOver: true, via: "list" });
    expect(el.shadowRoot!.querySelector("[data-equipment-confirm]")).toBeNull();
    expect(isOpen(el)).toBe(true);
  });

  it("is inert while disabled, and turning disabled on closes an open sheet", async () => {
    film();
    const { el } = await mountSheet();
    await open(el);

    el.disabled = true;
    await el.updateComplete;
    await expect.poll(() => isOpen(el)).toBe(false);
    expect(scanner(el)).toBeNull();
    expect(sheet(el).disabled).toBe(true);
    el.show();
    await el.updateComplete;
    expect(isOpen(el)).toBe(false);
    expect(box(el, "cardReaderId").disabled).toBe(true);
  });

  it("shows a reader refusal under Card reader, and a printer problem on the button", async () => {
    const { el } = await mountSheet({ errors: { card_terminal: "Take it first" }, badge: true });

    expect(box(el, "cardReaderId").error).toBe("Take it first");
    expect(box(el, "receiptPrinterId").error).toBe("");
    expect(sheet(el).querySelector('[slot="badge"]')).not.toBeNull();
    expect(sheet(el).label).toBe(t("device_sheet.label_problem"));
  });

  it("keeps a reader refusal on screen when the reader list comes back empty", async () => {
    const { el } = await mountSheet({ errors: { card_terminal: "Take it first" } });
    el.equipment = { roles: [roleOf("card_terminal", null, [])] };
    await el.updateComplete;
    expect(box(el, "cardReaderId")?.error).toBe("Take it first");
  });

  it("draws the reader's problem only on a profile that takes cards on a reader", async () => {
    const reason = { readerReason: "Reader 2 is switched off" };
    const withCard = await mountSheet(reason);
    const cashOnly = await mountSheet({ ...reason, capabilities: ["print-receipt"] });

    expect(withCard.el.shadowRoot!.querySelector("[data-pay-reader-reason]")).not.toBeNull();
    expect(cashOnly.el.shadowRoot!.querySelector("[data-pay-reader-reason]")).toBeNull();
  });

  it("adds the NFC sentence where the browser supports NFC, and drops it once NFC proved unavailable", async () => {
    const hint = (el: TillDeviceSheet) =>
      el.shadowRoot!.querySelector("[data-device-sheet-hint]")!.textContent!.trim();
    const { el } = await mountSheet();
    expect(hint(el)).toBe(t("device_sheet.hint"));

    el.nfcPermission = "granted";
    await el.updateComplete;
    expect(hint(el)).toBe(`${t("device_sheet.hint")} ${t("device_sheet.hint_nfc")}`);

    el.nfcUnavailable = true;
    await el.updateComplete;
    expect(hint(el)).toBe(t("device_sheet.hint"));

    el.notice = { message: "Picked up Reader 3", tone: "info" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-device-sheet-hint]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-pay-notice]")!.textContent).toContain(
      "Picked up Reader 3",
    );
  });

  it("keeps Allow NFC while permission is prompt, after a sticker's notice too", async () => {
    const { el } = await mountSheet({ nfcPermission: "prompt" });
    el.notice = { message: "Picked up Reader 3", tone: "info" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-pay-nfc]")).not.toBeNull();
  });
});
