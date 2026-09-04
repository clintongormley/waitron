import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./devices-screen.js";
import type { DevicesScreen } from "./devices-screen.js";
import type { Canvas, DashboardApi, DeviceRow, Printer, Station, Till } from "../api/client.js";

/**
 * The Devices screen scanned by axe in both themes, in two states: the default list + generate form, and
 * after a code has been generated (the shown-once code panel). Mounted by ASSIGNING the `api` STUB as a
 * property (never bare markup), exactly as the sibling screen a11y suites do: `connectedCallback` fires
 * `void this.#load()` → `listDevices()` + `listStations()`, so the stub must resolve both or a stray
 * rejection pollutes the run (a rejection is a finding).
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
    canvasId: "p1",
  },
  {
    id: "d2",
    kind: "kds_station",
    stationId: null,
    label: "Pase",
    active: false,
    lastSeenAt: null,
    enrolledAt: "2026-08-19T09:00:00.000Z",
    canvasId: null,
  },
];

const tills: Till[] = [
  { id: "t1", label: "Caja 1", locationId: "loc1", receiptPrinterId: null },
  { id: "t2", label: "Caja 2", locationId: "loc1", receiptPrinterId: null },
];

const canvases: Canvas[] = [
  { id: "p1", name: "Comedor", definition: { areas: [] } },
  { id: "p2", name: "Barra", definition: { areas: [] } },
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
    listTills: vi.fn().mockResolvedValue(tills),
    listCanvases: vi.fn().mockResolvedValue(canvases),
    listPrinters: vi.fn().mockResolvedValue(printers),
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

  it("renders the handheld kind (station picker hidden) accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    // Switch the kind picker to a handheld — the station <select> is removed from the form.
    const kind = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=kind-select]")!;
    kind.value = "handheld";
    kind.dispatchEvent(new Event("change"));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("renders the till kind (till + hardware pickers) accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    // Switch the kind picker to a till — the till picker + the hardware pickers (receipt printer,
    // cash-drawer switch, card provider) render, and with the Stripe Terminal provider the card-reader
    // field joins them, so the whole till-form state is in the a11y tree.
    const kind = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=kind-select]")!;
    kind.value = "till";
    kind.dispatchEvent(new Event("change"));
    await el.updateComplete;
    const provider = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "[data-test=card-provider-select]",
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
