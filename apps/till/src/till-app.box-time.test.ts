import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceEquipmentRead, StaffNotice } from "./api/client.js";
import type { TillApp } from "./till-app.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { emit, mountEquipmentApp, signIn } from "../test/equipment-app.js";
import { NFC_EQUIPMENT } from "../test/equipment-nfc.js";

const UNUSABLE: StaffNotice = {
  owner: "fiscal",
  key: "clock.unusable",
  code: "clock.unusable",
  severity: "error",
  params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
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
    listApprovers: vi.fn().mockResolvedValue([]),
  });
  await signIn(el);
  await vi.waitFor(() => expect(strip(el)?.notices).toEqual([UNUSABLE]));
  await settle(el);
  return { el, getDeviceEquipment, boxClockConfirm };
}

describe("the till's Check the time", () => {
  afterEach(cleanupWidgets);

  it("offers it on the strip while the box sends the marker, which is drawn as no line", async () => {
    const { el } = await mounted(read([MARKER, UNUSABLE]));
    expect(strip(el)!.checkTimeOffered).toBe(true);
  });

  it("does not offer it without the marker", async () => {
    const { el } = await mounted(read([UNUSABLE]));
    expect(strip(el)!.checkTimeOffered).toBe(false);
    expect(dialog(el)).toBeNull();
  });

  it("drops the offer on logging out", async () => {
    const { el } = await mounted(read([MARKER, UNUSABLE]));
    expect(strip(el)!.checkTimeOffered).toBe(true);
    emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
    expect((el as unknown as { checkTimeOffered: boolean }).checkTimeOffered).toBe(false);
  });

  it("keeps the offer through a read that could not reach the box's clock", async () => {
    const { el, getDeviceEquipment } = await mounted(read([MARKER, UNUSABLE]));
    getDeviceEquipment.mockResolvedValue({
      ...read([UNUSABLE]),
      noticesUnavailable: ["box-clock"],
    });
    emit(el.shadowRoot!.querySelector("till-shell")!, "open-equipment");
    await vi.waitFor(() => expect(getDeviceEquipment.mock.calls.length).toBeGreaterThan(1));
    await settle(el);
    expect(strip(el)!.checkTimeOffered).toBe(true);
  });

  it("opens the dialog on till-check-time and reads the equipment again at once after a success", async () => {
    const { el, getDeviceEquipment, boxClockConfirm } = await mounted(read([MARKER, UNUSABLE]));
    strip(el)!.dispatchEvent(new CustomEvent("till-check-time", { bubbles: true, composed: true }));
    await settle(el);
    const opened = dialog(el)!;
    expect(opened).not.toBeNull();
    await settle(el);
    const reads = getDeviceEquipment.mock.calls.length;
    opened.shadowRoot!.querySelector<HTMLElement>('[data-box-time="yes"]')!.click();
    await settle(el);
    expect(boxClockConfirm).toHaveBeenCalledTimes(1);
    expect(getDeviceEquipment.mock.calls.length).toBe(reads + 1);
    await vi.waitFor(() => expect(strip(el)!.checkTimeOffered).toBe(false));
    opened.shadowRoot!.querySelector<HTMLElement>('[data-box-time="close"]')!.click();
    await settle(el);
    expect(dialog(el)).toBeNull();
  });
});
