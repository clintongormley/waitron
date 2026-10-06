import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./device-profiles-screen.js";
import type { DeviceProfilesScreen } from "./device-profiles-screen.js";
import type { Canvas, DeviceProfile, DashboardApi, Printer } from "../api/client.js";

/**
 * Scanned in LIST and EDITOR mode. The `api` stub must resolve `listDeviceProfiles`, `listCanvases`,
 * `listPrinters` and `getDeviceProfile`, or a stray rejection pollutes the run.
 */
const canvases: Canvas[] = [{ id: "c1", name: "Counter till", definition: {} }];

const profiles: DeviceProfile[] = [
  {
    id: "p1",
    name: "Front counter",
    canvasId: "c1",
    capabilities: ["integrated-card-payment"],
    formFactor: "till",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: ["pr2", "pr1"],
    paymentSlipPrinterIds: ["pr-old"],
  },
];

function printer(id: string, name: string, active = true): Printer {
  return {
    id,
    name,
    transport: "network_tcp",
    host: "10.0.0.9",
    port: 9100,
    localKey: null,
    pollId: null,
    watcherId: null,
    paperWidth: "80mm",
    resolution: "180dpi",
    hasCashDrawer: false,
    pendingJobs: 0,
    lastPrintAt: null,
    lastPrintAgentId: null,
    active,
  };
}

/** Two on the receipt list, one off it, and a switched-off one the slip list still holds. */
const venuePrinters = [
  printer("pr1", "Barra"),
  printer("pr2", "Cocina"),
  printer("pr3", "Terraza"),
  printer("pr-old", "Vieja", false),
];

function stubApi(printers: Printer[] = venuePrinters): DashboardApi {
  return {
    listPrinters: vi.fn().mockResolvedValue(printers),
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
    await vi.waitFor(() => {
      if (!el.shadowRoot!.querySelector("[data-test=receipt-printers-up-pr1]"))
        throw new Error("printer lists");
    });
    // Both printer lists, with order buttons and a switched-off printer still listed.
    expect(el.shadowRoot!.querySelector("[data-test=receipt-printers-up-pr1]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=payment-slip-printers-pr-old]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders the line asking for a printer first accessibly", async () => {
    const { el, host } = await mountWidget<DeviceProfilesScreen>(
      "dashboard-device-profiles-screen",
      { api: stubApi([]) },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-printers]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
