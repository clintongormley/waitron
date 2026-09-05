import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./device-profiles-screen.js";
import type { DeviceProfilesScreen } from "./device-profiles-screen.js";
import type { Canvas, DeviceProfile, DashboardApi } from "../api/client.js";

/**
 * The Device-profiles screen scanned by axe in both themes, in two states: LIST mode (the profile
 * gallery, its New-profile button, per-row Edit/Duplicate/Delete controls and capability summaries)
 * and EDITOR mode (the flat form — name field, canvas `<select>` and the capability switches). Mounted
 * by ASSIGNING the `api` STUB as a property (never bare markup), as the sibling screen a11y suites do:
 * `connectedCallback` fires `void this.#load()` → `listDeviceProfiles()` + `listCanvases()`, so the
 * stub must resolve both (and `getDeviceProfile`, reached when the editor opens) or a stray rejection
 * pollutes the run.
 */
const canvases: Canvas[] = [{ id: "c1", name: "Counter till", definition: {} }];

const profiles: DeviceProfile[] = [
  {
    id: "p1",
    name: "Front counter",
    canvasId: "c1",
    capabilities: ["integrated-card-payment"],
  },
];

function stubApi(): DashboardApi {
  return {
    listDeviceProfiles: vi.fn().mockResolvedValue(profiles),
    getDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    createDeviceProfile: vi.fn().mockResolvedValue({ ...profiles[0], id: "p9" }),
    updateDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    deleteDeviceProfile: vi.fn().mockResolvedValue(undefined),
    listCanvases: vi.fn().mockResolvedValue(canvases),
  } as unknown as DashboardApi;
}

async function flush(el: DeviceProfilesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("device-profiles-screen a11y (%s theme)", (theme) => {
  it("renders the profile gallery with its controls accessibly", async () => {
    const { el, host } = await mountWidget<DeviceProfilesScreen>(
      "dashboard-device-profiles-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the editor form accessibly", async () => {
    const { el, host } = await mountWidget<DeviceProfilesScreen>(
      "dashboard-device-profiles-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
