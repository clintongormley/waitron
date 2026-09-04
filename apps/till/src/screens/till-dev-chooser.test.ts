import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_DEVICE_STORAGE_KEY } from "../api/dev-device.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillDevChooser } from "./till-dev-chooser.js";
import type { DevDeviceList, DevMintResult, TillApi } from "../api/client.js";

/**
 * A fake `TillApi` exposing only the three dev-route verbs the chooser calls. Each defaults to a benign
 * value a test overrides with its own `vi.fn()`. Cast through `unknown` because the screen touches only
 * these three verbs, never the rest of the class surface (the `till-device-enrol-screen.test.ts` pattern).
 */
type DevVerbs = "getDevDevices" | "mintDevDevice" | "resetDevice";
function stubApi(overrides: Partial<Record<DevVerbs, unknown>> = {}): TillApi {
  return {
    getDevDevices: vi.fn().mockResolvedValue(emptyList()),
    mintDevDevice: vi
      .fn()
      .mockResolvedValue({ deviceId: "new1", kind: "handheld", stationId: null, label: "New" }),
    resetDevice: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

function emptyList(): DevDeviceList {
  return { devices: [], tills: [], stations: [], canvases: [] };
}

/** Lets a pending API promise settle and the element re-render. */
async function flush(el: TillDevChooser): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/** Sets a native `<select>`'s value and fires the `change` the render binds. */
function pickSelect(el: TillDevChooser, selector: string, value: string): void {
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>(selector)!;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

/** Sets a `wt-input`'s value and fires the `wt-change` the render binds (mirrors an operator typing). */
function typeInput(el: TillDevChooser, selector: string, value: string): void {
  const input = el.shadowRoot!.querySelector<HTMLElement>(selector)!;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

afterEach(() => {
  cleanupWidgets();
  sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
});

describe("till-dev-chooser", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-dev-chooser")).toBe(TillDevChooser);
  });

  it("lists devices from getDevDevices, resolving each device's till and canvas names", async () => {
    const list: DevDeviceList = {
      devices: [
        // A till-bound device (its till name renders; it has no canvas).
        {
          id: "d1",
          kind: "handheld",
          label: "Phone",
          tillId: "t1",
          canvasId: null,
          stationId: null,
          active: true,
        },
        // A canvas-bound device with no till (the canvas name renders; the till is absent).
        {
          id: "d2",
          kind: "kds_station",
          label: "Pass screen",
          tillId: null,
          canvasId: "p1",
          stationId: "s1",
          active: true,
        },
      ],
      tills: [{ id: "t1", name: "Caja 1", locationId: "l1" }],
      stations: [{ id: "s1", name: "Pass", displayOrder: 1, isDefault: true, active: true }],
      canvases: [{ id: "p1", name: "Big screen" }],
    };
    const { el } = await mountWidget<TillDevChooser>("till-dev-chooser", {
      api: stubApi({ getDevDevices: vi.fn().mockResolvedValue(list) }),
    });
    await flush(el);
    const text = el.shadowRoot!.textContent!;
    expect(text).toContain("Phone");
    expect(text).toContain("Caja 1"); // the till name of the till-bound device
    expect(text).toContain("Pass screen");
    expect(text).toContain("Big screen"); // the canvas name of the canvas-bound device
  });

  it("shows an empty-devices hint when no device is enrolled yet", async () => {
    const { el } = await mountWidget<TillDevChooser>("till-dev-chooser", {
      api: stubApi(), // stubApi's default getDevDevices resolves an empty list
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-use]")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("No devices enrolled yet");
  });

  it("picking a device stores its id and navigates to /", async () => {
    const navigate = vi.fn();
    const list: DevDeviceList = {
      devices: [
        {
          id: "d1",
          kind: "handheld",
          label: "Phone",
          tillId: null,
          canvasId: null,
          stationId: null,
          active: true,
        },
      ],
      tills: [],
      stations: [],
      canvases: [],
    };
    const { el } = await mountWidget<TillDevChooser>("till-dev-chooser", {
      api: stubApi({ getDevDevices: vi.fn().mockResolvedValue(list) }),
      navigate,
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-use="d1"]')!.click();
    expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBe("d1");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("submitting the mint form calls mintDevDevice and adopts the returned id", async () => {
    const navigate = vi.fn();
    const mintDevDevice = vi.fn().mockResolvedValue({
      deviceId: "minted7",
      kind: "handheld",
      stationId: null,
      label: "Phone",
    } satisfies DevMintResult);
    const list: DevDeviceList = {
      devices: [],
      tills: [{ id: "t1", name: "Caja 1", locationId: "l1" }],
      stations: [],
      canvases: [],
    };
    const { el } = await mountWidget<TillDevChooser>("till-dev-chooser", {
      api: stubApi({ getDevDevices: vi.fn().mockResolvedValue(list), mintDevDevice }),
      navigate,
    });
    await flush(el);
    pickSelect(el, "[data-mint-kind]", "handheld");
    await el.updateComplete;
    typeInput(el, "[data-mint-label]", "Phone");
    pickSelect(el, "[data-mint-till]", "t1");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-mint-submit]")!.click();
    await flush(el);
    expect(mintDevDevice).toHaveBeenCalledWith({ kind: "handheld", label: "Phone", tillId: "t1" });
    expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBe("minted7");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("mints a kds_station device with its stationId (not a tillId)", async () => {
    const navigate = vi.fn();
    const mintDevDevice = vi.fn().mockResolvedValue({
      deviceId: "kds3",
      kind: "kds_station",
      stationId: "s1",
      label: "Pass",
    } satisfies DevMintResult);
    const list: DevDeviceList = {
      devices: [],
      tills: [],
      stations: [{ id: "s1", name: "Pass", displayOrder: 1, isDefault: true, active: true }],
      canvases: [{ id: "p1", name: "Big screen" }],
    };
    const { el } = await mountWidget<TillDevChooser>("till-dev-chooser", {
      api: stubApi({ getDevDevices: vi.fn().mockResolvedValue(list), mintDevDevice }),
      navigate,
    });
    await flush(el);
    pickSelect(el, "[data-mint-kind]", "kds_station");
    await el.updateComplete;
    typeInput(el, "[data-mint-label]", "Pass");
    pickSelect(el, "[data-mint-station]", "s1");
    pickSelect(el, "[data-mint-canvas]", "p1");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-mint-submit]")!.click();
    await flush(el);
    expect(mintDevDevice).toHaveBeenCalledWith({
      kind: "kds_station",
      label: "Pass",
      stationId: "s1",
      canvasId: "p1",
    });
    expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBe("kds3");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("renders a rejected mint code inline and does not navigate", async () => {
    const navigate = vi.fn();
    const mintDevDevice = vi.fn().mockRejectedValue({ code: "device.mint_failed" });
    const { el } = await mountWidget<TillDevChooser>("till-dev-chooser", {
      api: stubApi({ mintDevDevice }),
      navigate,
    });
    await flush(el);
    typeInput(el, "[data-mint-label]", "Phone");
    el.shadowRoot!.querySelector<HTMLElement>("[data-mint-submit]")!.click();
    await flush(el);
    const error = el.shadowRoot!.querySelector('[role="alert"]');
    expect(error?.textContent).toContain("device.mint_failed");
    expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("falls back to a generic code when a rejected mint carries none", async () => {
    const navigate = vi.fn();
    const mintDevDevice = vi.fn().mockRejectedValue(new Error("boom")); // no `code` field
    const { el } = await mountWidget<TillDevChooser>("till-dev-chooser", {
      api: stubApi({ mintDevDevice }),
      navigate,
    });
    await flush(el);
    typeInput(el, "[data-mint-label]", "Phone");
    el.shadowRoot!.querySelector<HTMLElement>("[data-mint-submit]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      "server.internal",
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("mints once on a double-tap (the reentry guard)", async () => {
    const navigate = vi.fn();
    let settle!: (value: unknown) => void;
    const mintDevDevice = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => (settle = resolve)));
    const { el } = await mountWidget<TillDevChooser>("till-dev-chooser", {
      api: stubApi({ mintDevDevice }),
      navigate,
    });
    await flush(el);
    typeInput(el, "[data-mint-label]", "Phone");
    const submit = el.shadowRoot!.querySelector<HTMLElement>("[data-mint-submit]")!;
    submit.click(); // first tap: mint in flight
    submit.click(); // second tap: the `minting` guard makes it a no-op
    settle({ deviceId: "one", kind: "handheld", stationId: null, label: "Phone" });
    await flush(el);
    expect(mintDevDevice).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("resets this browser's cookie identity AND clears this tab's stored override", async () => {
    const resetDevice = vi.fn().mockResolvedValue(undefined);
    // This tab has already adopted a device — reset must un-adopt it, not just drop the cookie.
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "adopted1");
    const { el } = await mountWidget<TillDevChooser>("till-dev-chooser", {
      api: stubApi({ resetDevice }),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-reset]")!.click();
    await flush(el);
    expect(resetDevice).toHaveBeenCalledOnce();
    // The per-tab override is gone, so the tab reverts to the (now-cleared) cookie identity.
    expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBeNull();
  });

  it("handles a rejected reset inline rather than throwing an unhandled rejection", async () => {
    const resetDevice = vi.fn().mockRejectedValue({ code: "server.internal" });
    const { el } = await mountWidget<TillDevChooser>("till-dev-chooser", {
      api: stubApi({ resetDevice }),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-reset]")!.click();
    await flush(el);
    expect(resetDevice).toHaveBeenCalledOnce();
    // The rejected `{ code }` renders on the inline error surface — no unhandled promise rejection.
    expect(el.shadowRoot!.querySelector(".reset .error")!.textContent).toContain("server.internal");
  });

  it("renders a load-failure message (with WAITRON_ENV=dev guidance) when getDevDevices rejects", async () => {
    const { el } = await mountWidget<TillDevChooser>("till-dev-chooser", {
      api: stubApi({
        getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
      }),
    });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain("Couldn't load devices");
    expect(el.shadowRoot!.textContent).toContain("WAITRON_ENV=dev");
    // The device list + mint form are absent when the load failed.
    expect(el.shadowRoot!.querySelector("[data-mint-submit]")).toBeNull();
  });
});
