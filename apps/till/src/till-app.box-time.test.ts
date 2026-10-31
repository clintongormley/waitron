import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceEquipmentRead, StaffNotice } from "./api/client.js";
import type { TillApp } from "./till-app.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { mountEquipmentApp, signIn } from "../test/equipment-app.js";
import { NFC_EQUIPMENT } from "../test/equipment-nfc.js";

const BEHIND: StaffNotice = {
  owner: "fiscal",
  key: "clock.behind_chain",
  code: "clock.behind_chain",
  severity: "error",
  params: {},
};
const MARKER: StaffNotice = {
  owner: "box-clock",
  key: "clock.check_time",
  code: "clock.check_time",
  severity: "error",
  params: {},
};

const read = (notices: StaffNotice[]): DeviceEquipmentRead => ({ ...NFC_EQUIPMENT, notices });

async function settle(el: TillApp): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

const strip = (el: TillApp) =>
  el.shadowRoot!.querySelector<HTMLElement & { checkTimeOffered: boolean; notices: unknown }>(
    "till-notice-strip",
  );
const dialog = (el: TillApp) => el.shadowRoot!.querySelector("till-box-time-dialog");

async function mounted(first: DeviceEquipmentRead) {
  const getDeviceEquipment = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(read([]));
  const boxClockChallenge = vi
    .fn()
    .mockResolvedValue({ challengeId: "c1", boxAt: new Date().toISOString() });
  const boxClockConfirm = vi.fn().mockResolvedValue({
    confirmationId: "k1",
    stepMs: 0,
    confirmedAt: new Date().toISOString(),
  });
  const { el } = await mountEquipmentApp({
    getDeviceEquipment,
    boxClockChallenge,
    boxClockConfirm,
    listAdjustmentApprovers: vi.fn().mockResolvedValue([]),
  });
  await signIn(el);
  await vi.waitFor(() => expect(strip(el)?.notices).toEqual([BEHIND]));
  await settle(el);
  return { el, getDeviceEquipment, boxClockConfirm };
}

describe("the till's Check the time", () => {
  afterEach(cleanupWidgets);

  it("offers it on the strip while the box sends the marker, which is drawn as no line", async () => {
    const { el } = await mounted(read([MARKER, BEHIND]));
    expect(strip(el)!.checkTimeOffered).toBe(true);
  });

  it("does not offer it without the marker", async () => {
    const { el } = await mounted(read([BEHIND]));
    expect(strip(el)!.checkTimeOffered).toBe(false);
    expect(dialog(el)).toBeNull();
  });

  it("opens the dialog on till-check-time and reads the equipment again at once after a success", async () => {
    const { el, getDeviceEquipment, boxClockConfirm } = await mounted(read([MARKER, BEHIND]));
    strip(el)!.dispatchEvent(new CustomEvent("till-check-time", { bubbles: true, composed: true }));
    await settle(el);
    const opened = dialog(el)!;
    expect(opened).not.toBeNull();
    await settle(el);
    const reads = getDeviceEquipment.mock.calls.length;
    opened.shadowRoot!.querySelector<HTMLElement>('[data-box-time="primary"]')!.click();
    await settle(el);
    expect(boxClockConfirm).toHaveBeenCalledTimes(1);
    expect(getDeviceEquipment.mock.calls.length).toBe(reads + 1);
    await vi.waitFor(() => expect(strip(el)!.checkTimeOffered).toBe(false));
    opened.shadowRoot!.querySelector<HTMLElement>('[data-box-time="close"]')!.click();
    await settle(el);
    expect(dialog(el)).toBeNull();
  });
});
