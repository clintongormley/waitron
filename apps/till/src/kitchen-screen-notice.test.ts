import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillKitchenScreenNotice, type KitchenScreenNotice } from "./kitchen-screen-notice.js";
import type { DeviceIdentity, ResolvedKitchenScreen, TillApi } from "./api/client.js";
afterEach(cleanupWidgets);

describe("a kitchen display's notice in place of a queue", () => {
  const identity = (kitchenScreens: ResolvedKitchenScreen[]): DeviceIdentity => ({
    deviceId: "kd-1",
    formFactor: "kds",
    name: "Pantalla Pase",
    kitchenScreens,
  });
  const passGone = identity([{ kind: "pass", available: false, stations: [], zones: null }]);
  const passBack = identity([{ kind: "pass", available: true, stations: [], zones: null }]);

  const listening: [string, EventListener][] = [];
  const listen = (type: string) => {
    const listener = vi.fn();
    document.addEventListener(type, listener);
    listening.push([type, listener]);
    return listener;
  };

  async function mountNotice(
    getDeviceIdentity: TillApi["getDeviceIdentity"],
    kitchenScreenNotice: KitchenScreenNotice = { kind: "unavailable", screen: "pass" },
  ) {
    const changed = listen("kitchen-screen-changed");
    const unauthorized = listen("device-unauthorized");
    const { el } = await mountWidget<TillKitchenScreenNotice>("till-kitchen-screen-notice", {
      api: { getDeviceIdentity },
      notice: kitchenScreenNotice,
    });
    return { el, changed, unauthorized };
  }

  async function withFakeTimers(run: () => Promise<void>) {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      await run();
    } finally {
      vi.useRealTimers();
      for (const [type, listener] of listening.splice(0))
        document.removeEventListener(type, listener);
    }
  }

  it("reads the device's choice at each refresh and asks for a re-boot once its screen is offered again", () =>
    withFakeTimers(async () => {
      const getDeviceIdentity = vi.fn().mockResolvedValueOnce(passGone).mockResolvedValue(passBack);
      const { el, changed } = await mountNotice(getDeviceIdentity);
      expect(el.querySelector(".kitchen-screen-message")).not.toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(getDeviceIdentity).toHaveBeenCalledTimes(1);
      expect(changed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(changed).toHaveBeenCalledTimes(1);
    }));

  it("asks for a re-boot when a different screen is chosen in place of the one taken", () =>
    withFakeTimers(async () => {
      const getDeviceIdentity = vi
        .fn()
        .mockResolvedValue(
          identity([{ kind: "station", available: false, stations: [], zones: null }]),
        );
      const { changed } = await mountNotice(getDeviceIdentity);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(changed).toHaveBeenCalledTimes(1);
    }));

  it("says the device was refused when the read answers device.unauthorized, and nothing for another failure", () =>
    withFakeTimers(async () => {
      const getDeviceIdentity = vi
        .fn()
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockRejectedValue({ code: "device.unauthorized" });
      const { changed, unauthorized } = await mountNotice(getDeviceIdentity);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(unauthorized).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(unauthorized).toHaveBeenCalledTimes(1);
      expect(changed).not.toHaveBeenCalled();
    }));

  it("with no screen chosen yet, waits for one and asks for a re-boot once it is chosen", () =>
    withFakeTimers(async () => {
      const getDeviceIdentity = vi
        .fn()
        .mockResolvedValueOnce(identity([]))
        .mockResolvedValue(passBack);
      const { el, changed } = await mountNotice(getDeviceIdentity, { kind: "none" });
      expect(el.querySelector("[data-choose-again]")).toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(changed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(changed).toHaveBeenCalledTimes(1);
    }));

  it("ignores an older read that answers after a newer one", () =>
    withFakeTimers(async () => {
      let answerLate: (value: DeviceIdentity) => void = () => {};
      const getDeviceIdentity = vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)))
        .mockResolvedValue(passGone);
      const { changed } = await mountNotice(getDeviceIdentity);
      await vi.advanceTimersByTimeAsync(30_000);
      answerLate(passBack);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(changed).not.toHaveBeenCalled();
    }));

  it("asks once when two reads that overlap both say the choice changed", () =>
    withFakeTimers(async () => {
      const answers: ((value: DeviceIdentity) => void)[] = [];
      const getDeviceIdentity = vi.fn(
        () => new Promise<DeviceIdentity>((resolve) => answers.push(resolve)),
      );
      const { changed } = await mountNotice(getDeviceIdentity);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(answers).toHaveLength(2);
      answers[0]!(passBack);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(changed).toHaveBeenCalledTimes(1);
      answers[1]!(passBack);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(changed).toHaveBeenCalledTimes(1);
    }));

  it("asks again at a later refresh while it is still on the page after asking", () =>
    withFakeTimers(async () => {
      const getDeviceIdentity = vi.fn().mockResolvedValue(passBack);
      const { changed } = await mountNotice(getDeviceIdentity);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(changed).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(changed).toHaveBeenCalledTimes(2);
    }));

  it("says the device was refused once when two reads that overlap are both refused", () =>
    withFakeTimers(async () => {
      const refusals: ((reason: unknown) => void)[] = [];
      const getDeviceIdentity = vi.fn(
        () => new Promise<DeviceIdentity>((_resolve, reject) => refusals.push(reject)),
      );
      const { changed, unauthorized } = await mountNotice(getDeviceIdentity);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(refusals).toHaveLength(2);
      refusals[0]!({ code: "device.unauthorized" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unauthorized).toHaveBeenCalledTimes(1);
      refusals[1]!({ code: "device.unauthorized" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unauthorized).toHaveBeenCalledTimes(1);
      expect(changed).not.toHaveBeenCalled();
    }));

  it("says the device was refused again at a later refresh while it is still on the page", () =>
    withFakeTimers(async () => {
      const getDeviceIdentity = vi.fn().mockRejectedValue({ code: "device.unauthorized" });
      const { unauthorized } = await mountNotice(getDeviceIdentity);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(unauthorized).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(unauthorized).toHaveBeenCalledTimes(2);
    }));

  it("stops reading once it is taken off the page", () =>
    withFakeTimers(async () => {
      const getDeviceIdentity = vi.fn().mockResolvedValue(passGone);
      const { el } = await mountNotice(getDeviceIdentity);
      el.remove();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(getDeviceIdentity).not.toHaveBeenCalled();
    }));
});
