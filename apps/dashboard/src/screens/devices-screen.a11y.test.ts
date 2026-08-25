import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./devices-screen.js";
import type { DevicesScreen } from "./devices-screen.js";
import type { DashboardApi, DeviceRow, Station } from "../api/client.js";

/**
 * The Devices screen scanned by axe in both themes, in two states: the default list + generate form, and
 * after a code has been generated (the shown-once code panel). Mounted by ASSIGNING the `api` STUB as a
 * property (never bare markup), exactly as the sibling screen a11y suites do: `connectedCallback` fires
 * `void this.#load()` → `listDevices()` + `listStations()`, so the stub must resolve both or a stray
 * rejection pollutes the run (a rejection is a finding).
 */
const stations: Station[] = [
  { id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
  { id: "s2", name: "Barra", displayOrder: 1, isDefault: false, active: true },
];

const devices: DeviceRow[] = [
  {
    id: "d1",
    kind: "kds_station",
    stationId: "s1",
    label: "Pantalla Cocina",
    active: true,
    lastSeenAt: "2026-08-25T14:30:00.000Z",
    enrolledAt: "2026-08-20T09:00:00.000Z",
  },
  {
    id: "d2",
    kind: "kds_station",
    stationId: null,
    label: "Pase",
    active: false,
    lastSeenAt: null,
    enrolledAt: "2026-08-19T09:00:00.000Z",
  },
];

function stubApi(): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue(devices),
    listStations: vi.fn().mockResolvedValue(stations),
    createDeviceCode: vi.fn().mockResolvedValue({ code: "ABCD2345" }),
    revokeDevice: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

/** Settles the in-flight load and the follow-up render. */
async function flush(el: DevicesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("devices-screen a11y (%s theme)", (theme) => {
  it("renders the list and generate form accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the shown-once code panel accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    // Type a label and generate a code so the shown-once panel is in the a11y tree (the station picker
    // defaults to the first station).
    el.shadowRoot!.querySelector("[data-test=code-label]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Nueva pantalla" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=generate]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
