import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { DeviceStationScreen, StationQueue, TillApi } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TillStationQueue } from "../widgets/station-queue.js";
import { TillStationScreen } from "./till-station-screen.js";
import { allergyBlock, allergyNotice, allergyQueue } from "../../test/kitchen-allergy-fixtures.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
  setLocale(locale);
});
const station = {
  id: "station-1",
  name: "Grill",
  isDefault: true,
  active: true,
  open: true,
  byHand: null,
  sendsTo: null,
  why: "default",
} as const;
const snapshot = (): StationQueue => ({
  items: [allergyQueue()],
  notices: [allergyNotice("changed")],
  printersDown: [],
});
const deviceSnapshot = (): DeviceStationScreen => ({
  stations: [
    {
      ...station,
      available: true,
      today: station,
      queue: snapshot().items,
      notices: snapshot().notices,
      printersDown: [],
    },
  ],
});
const queue = (el: TillStationScreen) =>
  el.shadowRoot!.querySelector<TillStationQueue>("till-station-queue")!;
async function clickAck(el: TillStationScreen) {
  const button = queue(el).shadowRoot!.querySelector<HTMLElement>("[data-acknowledge]")!;
  await userEvent.click(button);
}
async function mount(deviceMode: boolean, overrides: Record<string, unknown> = {}) {
  setLocale("en");
  const api = {
    listStations: vi.fn(async () => [station]),
    getDeviceIdentity: vi.fn(async () => ({ kitchenScreens: [] })),
    getStationQueue: vi.fn(async () => snapshot()),
    getDeviceStationScreen: vi.fn(async () => deviceSnapshot()),
    acknowledgeKitchenNotice: vi.fn(async () => {}),
    deviceAcknowledgeKitchenNotice: vi.fn(async () => {}),
    ...overrides,
  } as unknown as TillApi;
  const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
    api,
    deviceMode,
  });
  await vi.waitFor(() => expect(queue(el)?.notices).toHaveLength(1));
  await queue(el).updateComplete;
  return { el, api };
}

describe("A669 boards acknowledgement", () => {
  for (const deviceMode of [false, true]) {
    it(`acknowledges the exact allergy notice through device=${deviceMode} and retains the original`, async () => {
      const { el, api } = await mount(deviceMode);
      await clickAck(el);
      await vi.waitFor(() => expect(queue(el).notices).toEqual([]));
      expect(
        deviceMode ? api.deviceAcknowledgeKitchenNotice : api.acknowledgeKitchenNotice,
      ).toHaveBeenCalledWith("allergy-changed");
      expect(
        deviceMode ? api.acknowledgeKitchenNotice : api.deviceAcknowledgeKitchenNotice,
      ).not.toHaveBeenCalled();
      expect(queue(el).shadowRoot!.querySelector('[data-item="ticked"]')!.textContent).toContain(
        allergyBlock.who,
      );
    });
    it(`retains the notice on an acknowledgement refusal, device=${deviceMode}`, async () => {
      const refused = vi.fn().mockRejectedValue({ code: "server.internal" });
      const { el } = await mount(deviceMode, {
        [deviceMode ? "deviceAcknowledgeKitchenNotice" : "acknowledgeKitchenNotice"]: refused,
      });
      await clickAck(el);
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
          t("station.acknowledge_error"),
        ),
      );
      expect(queue(el).notices.map((notice) => notice.id)).toEqual(["allergy-changed"]);
      expect(queue(el).shadowRoot!.querySelector('[data-item="ticked"]')!.textContent).toContain(
        allergyBlock.who,
      );
    });
    it(`does not resurrect an acknowledged allergy from an earlier read, device=${deviceMode}`, async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      let answer!: (value: StationQueue | DeviceStationScreen) => void;
      let settled = false;
      const late = new Promise<StationQueue | DeviceStationScreen>((resolve) => {
        answer = resolve;
      });
      const read = vi
        .fn()
        .mockResolvedValueOnce(deviceMode ? deviceSnapshot() : snapshot())
        .mockImplementationOnce(async () => {
          const value = await late;
          settled = true;
          return value;
        });
      const { el } = await mount(deviceMode, {
        [deviceMode ? "getDeviceStationScreen" : "getStationQueue"]: read,
      });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(read).toHaveBeenCalledTimes(2);
      await clickAck(el);
      await vi.waitFor(() => expect(queue(el).notices).toEqual([]));
      answer(deviceMode ? deviceSnapshot() : snapshot());
      await vi.waitFor(() => expect(settled).toBe(true));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await el.updateComplete;
      await queue(el).updateComplete;
      expect(queue(el).shadowRoot!.querySelector("[data-notice]")).toBeNull();
      expect(queue(el).shadowRoot!.querySelector('[data-item="ticked"]')!.textContent).toContain(
        allergyBlock.who,
      );
    });
  }
});
