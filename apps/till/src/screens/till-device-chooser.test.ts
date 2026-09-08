import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_DEVICE_STORAGE_KEY } from "../api/dev-device.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillDeviceChooser } from "./till-device-chooser.js";
import type { DevDeviceList, TillApi } from "../api/client.js";
import type { TillEnrolScreen } from "./till-enrol-screen.js";

/**
 * A fake `TillApi`. `getDevDevices` feeds the chooser's list; `join`/`joinStatus`/`getLocales` feed the
 * embedded `till-enrol-screen` the "Set up a new device" section mounts. Cast through `unknown` — the
 * chooser + its embedded screen touch only these verbs.
 */
type ChooserVerbs = "getDevDevices" | "join" | "joinStatus" | "getLocales";
function stubApi(overrides: Partial<Record<ChooserVerbs, unknown>> = {}): TillApi {
  return {
    getDevDevices: vi.fn().mockResolvedValue(emptyList()),
    join: vi.fn().mockResolvedValue({ joinId: "jr-1", verificationNumber: "47" }),
    joinStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    getLocales: vi.fn().mockResolvedValue({ locales: [] }),
    ...overrides,
  } as unknown as TillApi;
}

function emptyList(): DevDeviceList {
  return { devices: [] };
}

async function flush(el: TillDeviceChooser): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(() => {
  cleanupWidgets();
  sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
});

describe("till-device-chooser", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-device-chooser")).toBe(TillDeviceChooser);
  });

  it("lists devices from getDevDevices, labelling each device's kind in human words", async () => {
    const list: DevDeviceList = {
      devices: [
        { id: "d1", kind: "handheld", label: "Phone", tillId: "t1", stationId: null, active: true },
        {
          id: "d2",
          kind: "kds_station",
          label: "Pass screen",
          tillId: null,
          stationId: "s1",
          active: true,
        },
      ],
    };
    const { el } = await mountWidget<TillDeviceChooser>("till-device-chooser", {
      api: stubApi({ getDevDevices: vi.fn().mockResolvedValue(list) }),
    });
    await flush(el);
    const text = el.shadowRoot!.textContent!;
    expect(text).toContain("Phone");
    expect(text).toContain("Pass screen");
    // Human kind labels — never the raw machine token.
    expect(text).toContain("Handheld");
    expect(text).toContain("Kitchen display");
    expect(text).not.toContain("kds_station");
  });

  it("uses a pre-fetched `list` without re-reading getDevDevices", async () => {
    const getDevDevices = vi.fn();
    const list: DevDeviceList = {
      devices: [
        { id: "d1", kind: "till", label: "Front", tillId: "t1", stationId: null, active: true },
      ],
    };
    const { el } = await mountWidget<TillDeviceChooser>("till-device-chooser", {
      api: stubApi({ getDevDevices }),
      list,
    });
    await flush(el);
    expect(getDevDevices).not.toHaveBeenCalled();
    expect(el.shadowRoot!.textContent).toContain("Front");
  });

  it("shows an empty-devices hint when none is enrolled yet", async () => {
    const { el } = await mountWidget<TillDeviceChooser>("till-device-chooser", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-use]")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("No devices enrolled yet");
  });

  it("Use this device stores the id in this tab's sessionStorage and navigates to /", async () => {
    const navigate = vi.fn();
    const list: DevDeviceList = {
      devices: [
        { id: "d1", kind: "handheld", label: "Phone", tillId: null, stationId: null, active: true },
      ],
    };
    const { el } = await mountWidget<TillDeviceChooser>("till-device-chooser", {
      api: stubApi({ getDevDevices: vi.fn().mockResolvedValue(list) }),
      navigate,
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-use="d1"]')!.click();
    expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBe("d1");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("Set up a new device is collapsed, then expands to the join screen's name field", async () => {
    const { el } = await mountWidget<TillDeviceChooser>("till-device-chooser", { api: stubApi() });
    await flush(el);
    // Collapsed by default: the toggle shows, the join screen does not.
    expect(el.shadowRoot!.querySelector("[data-setup-new]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-enrol-screen")).toBeNull();
    // Expand it.
    el.shadowRoot!.querySelector<HTMLElement>("[data-setup-new]")!.click();
    await el.updateComplete;
    const join = el.shadowRoot!.querySelector<TillEnrolScreen>("till-enrol-screen")!;
    expect(join).not.toBeNull();
    await join.updateComplete;
    await flush(el);
    // It starts where a fresh browser starts — a name and nothing else. There is no dev shortcut: an
    // admin opens pairing mode and accepts the number, exactly as in a venue.
    expect(join.shadowRoot!.querySelector("[data-name]")).not.toBeNull();
    expect(join.shadowRoot!.querySelector("[data-number]")).toBeNull();
  });

  it("an approved join writes the new id to this tab's sessionStorage and navigates", async () => {
    vi.useFakeTimers();
    try {
      const navigate = vi.fn();
      const { el } = await mountWidget<TillDeviceChooser>("till-device-chooser", {
        api: stubApi({
          join: vi.fn().mockResolvedValue({ joinId: "fresh-99", verificationNumber: "47" }),
          joinStatus: vi.fn().mockResolvedValue({ status: "approved" }),
        }),
        navigate,
      });
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-setup-new]")!.click();
      await el.updateComplete;
      const screen = el.shadowRoot!.querySelector<TillEnrolScreen>("till-enrol-screen")!;
      await screen.updateComplete;
      // Name it and knock.
      const name = screen.shadowRoot!.querySelector<HTMLElement & { value: string }>(
        "[data-name]",
      )!;
      name.value = "Front";
      name.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "Front" }, bubbles: true }),
      );
      await screen.updateComplete;
      screen.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
      await vi.advanceTimersByTimeAsync(0);
      await screen.updateComplete;
      // The admin approves; the next poll carries it.
      await vi.advanceTimersByTimeAsync(2_000);
      await el.updateComplete;
      // The chooser adopted the fresh device for THIS tab (its id, not the cookie) and booted into it.
      expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBe("fresh-99");
      expect(navigate).toHaveBeenCalledWith("/");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a load-failure hint (with WAITRON_ENV=dev guidance) when getDevDevices rejects", async () => {
    const { el } = await mountWidget<TillDeviceChooser>("till-device-chooser", {
      api: stubApi({ getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
    });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain("Couldn't load devices");
    expect(el.shadowRoot!.textContent).toContain("WAITRON_ENV=dev");
    // The device list + setup section are absent when the load failed.
    expect(el.shadowRoot!.querySelector("[data-setup-new]")).toBeNull();
  });
});
