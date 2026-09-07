import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./devices-screen.js";
import type { DevicesScreen } from "./devices-screen.js";
import type { DashboardApi, DeviceProfile, DeviceRow, Printer, Station } from "../api/client.js";

/**
 * The Devices screen scanned by axe in both themes, in three states: the default list + generate button
 * (each active row carrying its hardware editor), a row's hardware editor with the Stripe Terminal
 * reader field revealed, and the shown-once code panel. Mounted by ASSIGNING the `api` STUB as a
 * property (never bare markup), exactly as the sibling screen a11y suites do: `connectedCallback` fires
 * `void this.#load()` → the list verbs, so the stub must resolve them all or a stray rejection pollutes
 * the run (a rejection is a finding).
 */
const stations: Station[] = [
  {
    id: "s1",
    name: "Cocina",
    displayOrder: 0,
    isDefault: true,
    active: true,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
  {
    id: "s2",
    name: "Barra",
    displayOrder: 1,
    isDefault: false,
    active: true,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
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
    deviceProfileId: "dp1",
  },
  {
    id: "d2",
    kind: "kds_station",
    stationId: null,
    label: "Pase",
    active: false,
    lastSeenAt: null,
    enrolledAt: "2026-08-19T09:00:00.000Z",
    deviceProfileId: null,
  },
];

const deviceProfiles: DeviceProfile[] = [
  { id: "dp1", name: "Counter till", canvasId: "p1", capabilities: [], formFactor: "till" },
  {
    id: "dp2",
    name: "Waiter handheld",
    canvasId: "p2",
    capabilities: [],
    formFactor: "phone-portrait",
  },
];

const printers: Printer[] = [
  {
    id: "pr1",
    name: "Cocina",
    transport: "network_tcp",
    agentId: null,
    host: "10.0.0.9",
    port: 9100,
    usbPath: null,
    pollId: null,
    ticketScope: "station",
    active: true,
  },
];

function stubApi(): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue(devices),
    listStations: vi.fn().mockResolvedValue(stations),
    listDeviceProfiles: vi.fn().mockResolvedValue(deviceProfiles),
    listPrinters: vi.fn().mockResolvedValue(printers),
    createDeviceCode: vi.fn().mockResolvedValue({ code: "ABCD2345" }),
    revokeDevice: vi.fn().mockResolvedValue(undefined),
    reassignDeviceProfile: vi.fn().mockResolvedValue(undefined),
    patchDeviceHardware: vi.fn().mockResolvedValue({
      id: "d1",
      receiptPrinterId: null,
      hasCashDrawer: false,
      cardProvider: "stripe_terminal",
      cardReaderId: null,
    }),
  } as unknown as DashboardApi;
}

/** Settles the in-flight load and the follow-up render. */
async function flush(el: DevicesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("devices-screen a11y (%s theme)", (theme) => {
  it("renders the list, per-row hardware editors and generate button accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders a row's hardware editor with the Stripe Terminal reader field accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    // Switch the active row's card-provider to a Stripe Terminal reader — the card-reader-id field
    // joins the receipt-printer / cash-drawer / card-provider controls, so the whole hardware editor
    // state is in the a11y tree.
    const provider = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "[data-test=hw-card-provider-d1]",
    )!;
    provider.value = "stripe_terminal";
    provider.dispatchEvent(new Event("change"));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("renders the shown-once code panel accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    // Generate a code (a single button — no body) so the shown-once panel is in the a11y tree.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=generate]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
