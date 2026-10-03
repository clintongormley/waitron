import { expect, afterEach, describe, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import "./devices-screen.js";
import type { DevicesScreen } from "./devices-screen.js";
import type {
  DashboardApi,
  DeviceProfile,
  DeviceRow,
  JoinRequestRow,
  Printer,
  Station,
  Till,
  Watcher,
} from "../api/client.js";

/**
 * Scanned in three states: the default list, the pairing window OPEN, and the accept dialog. The stub
 * must resolve every list verb or a stray rejection pollutes the run. The last block pins that each
 * number button has a real accessible NAME and that the dialog works from the keyboard alone.
 */
const stations: Station[] = [
  {
    id: "s1",
    name: "Cocina",
    displayOrder: 0,
    isDefault: true,
    active: true,
    showsRestOfOrder: false,
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
    showsRestOfOrder: false,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
];

const watchers: Watcher[] = [
  {
    id: "w1",
    name: "Pass",
    everyStation: true,
    stationIds: [],
    everyZone: true,
    zoneIds: [],
    runsPass: true,
    displayOrder: 0,
    active: true,
    printerIds: [],
  },
];

const devices: DeviceRow[] = [
  {
    id: "d1",
    madeHereStationIds: [],
    kind: "kds_station",
    stationId: "s1",
    watcherId: null,
    label: "Pantalla Cocina",
    active: true,
    lastSeenAt: "2026-08-25T14:30:00.000Z",
    enrolledAt: "2026-08-20T09:00:00.000Z",
    deviceProfileId: "dp1",
    receiptPrinterId: "pr1",
    paymentSlipPrinterId: null,
  },
  {
    id: "d2",
    madeHereStationIds: [],
    kind: "kds_station",
    stationId: null,
    watcherId: null,
    label: "Pase",
    active: false,
    lastSeenAt: null,
    enrolledAt: "2026-08-19T09:00:00.000Z",
    deviceProfileId: null,
    receiptPrinterId: null,
    paymentSlipPrinterId: null,
  },
];

const deviceProfiles: DeviceProfile[] = [
  {
    id: "dp1",
    name: "Counter till",
    canvasId: "p1",
    capabilities: [],
    formFactor: "till",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
  },
  {
    id: "dp2",
    name: "Waiter handheld",
    canvasId: "p2",
    capabilities: [],
    formFactor: "phone-portrait",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
  },
  {
    id: "dp3",
    name: "Pass screen",
    canvasId: null,
    capabilities: [],
    formFactor: "kds",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
  },
];

const tills: Till[] = [
  { id: "t1", label: "Caja 1", locationId: "l1", receiptPrinterId: null, opensDrawer: true },
];

const pending: JoinRequestRow[] = [
  { id: "j1", kind: "device", label: "Pantalla pase", createdAt: "2026-09-08T10:02:00.000Z" },
];

const CHOICES = ["12", "47", "83"];

const printers: Printer[] = [
  {
    id: "pr1",
    name: "Cocina",
    transport: "network_tcp",
    pendingJobs: 0,
    lastPrintAt: null,
    lastPrintAgentId: null,
    host: "10.0.0.9",
    port: 9100,
    localKey: null,
    pollId: null,
    watcherId: null,
    paperWidth: "80mm",
    resolution: "180dpi",
    hasCashDrawer: false,
    active: true,
  },
];

function stubApi(pairingOpen = false): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue(devices),
    listStations: vi.fn().mockResolvedValue(stations),
    listWatchers: vi.fn().mockResolvedValue(watchers),
    listDeviceProfiles: vi.fn().mockResolvedValue(deviceProfiles),
    listPrinters: vi.fn().mockResolvedValue(printers),
    listTills: vi.fn().mockResolvedValue(tills),
    pairingMode: vi.fn().mockResolvedValue({
      open: pairingOpen,
      openUntil: pairingOpen ? "2026-09-08T10:20:00.000Z" : null,
      refusedRecently: pairingOpen ? 0 : 2,
    }),
    openPairingMode: vi.fn().mockResolvedValue({ openUntil: "2026-09-08T10:20:00.000Z" }),
    closePairingMode: vi.fn().mockResolvedValue(undefined),
    joinRequests: vi.fn().mockResolvedValue(pending),
    joinChallenge: vi.fn().mockResolvedValue({ choices: CHOICES }),
    denyJoinRequest: vi.fn().mockResolvedValue(undefined),
    acceptDeviceJoinRequest: vi
      .fn()
      .mockResolvedValue({ deviceId: "j1", name: "Pantalla pase", formFactor: "kds" }),
    revokeDevice: vi.fn().mockResolvedValue(undefined),
    reassignDeviceProfile: vi.fn().mockResolvedValue(undefined),
    listReaders: vi.fn().mockResolvedValue([
      {
        id: "r1",
        provider: "sumup",
        name: "Front counter",
        active: true,
        canEnable: true,
        deviceCount: 1,
      },
    ]),
    getDeviceReader: vi.fn().mockResolvedValue({ readerId: "r1" }),
    setDeviceReader: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

async function flush(el: DevicesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("devices-screen a11y (%s theme)", (theme) => {
  it.each([390, 1280])(
    "renders a till's made-here station group accessibly at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const till: DeviceRow = {
        ...devices[0]!,
        id: "till",
        kind: "till",
        madeHereStationIds: ["s2"],
      };
      const { el, host } = await mountWidget<DevicesScreen>(
        "dashboard-devices-screen",
        {
          api: {
            ...stubApi(),
            listDevices: vi.fn().mockResolvedValue([till]),
          } as unknown as DashboardApi,
        },
        theme,
      );
      await flush(el);
      expect(el.shadowRoot!.querySelector('[data-test="made-here-till"]')).toBeTruthy();
      expect(el.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({ path: `__screenshots__/made-here-${theme}-${width}.png` });
      await page.viewport(1280, 900);
    },
  );

  it("renders the list, each row's printers and its hardware editor accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=device-receipt-printer-d1]")).toBeTruthy();
    await expectNoA11yViolations(host);
  });

  it("renders the open pairing window accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      { api: stubApi(true) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the accept dialog and its three numbers accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      { api: stubApi(true) },
      theme,
    );
    await flush(el);
    // Open the waiting row and choose a kds profile, so the station picker AND the three number
    // buttons are both in the a11y tree (a modal <dialog> is only exposed once it is open).
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=join-review-j1]")!.click();
    await flush(el);
    await chooseOption(el.shadowRoot!.querySelector("[data-test=join-profile]")!, "dp3");
    await el.updateComplete;
    const binding = el.shadowRoot!.querySelector("[data-test=join-binding]")!;
    await userEvent.click(binding.shadowRoot!.querySelector(".trigger")!);
    expect(
      Array.from(binding.shadowRoot!.querySelectorAll(".group-heading")).map((group) =>
        group.textContent?.trim(),
      ),
    ).toEqual(["Estaciones", "Puntos de seguimiento"]);
    await expectNoA11yViolations(host);
  });
});

describe("devices-screen a11y — the numeric match", () => {
  /** Opens the waiting row's dialog and picks the kds profile + station, so the numbers are tappable. */
  async function openReadyDialog(): Promise<DevicesScreen> {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api: stubApi(true),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=join-review-j1]")!.click();
    await flush(el);
    await chooseOption(el.shadowRoot!.querySelector("[data-test=join-profile]")!, "dp3");
    await el.updateComplete;
    await chooseOption(el.shadowRoot!.querySelector("[data-test=join-binding]")!, "station:s1");
    await el.updateComplete;
    return el;
  }

  // A bare "47" is not a name a screen reader can act on — the number has to be announced as one.
  // Read off the INNER <button>, which is the element that actually carries the name (wt-button
  // forwards `aria-label` into its shadow root).
  it("names every number button, not just labels it with the digits", async () => {
    const el = await openReadyDialog();
    const names = Array.from(el.shadowRoot!.querySelectorAll("[data-choice]")).map((b) =>
      b.shadowRoot!.querySelector("button")!.getAttribute("aria-label"),
    );
    expect(names).toEqual(
      CHOICES.map((n) => t("devices.join_choice_label", "es-ES").replace("{number}", n)),
    );
  });

  // Reachable AND operable from the keyboard alone: Enter on the focused row control opens the
  // dialog, and Enter on a focused number accepts with it. Real key events, not synthetic clicks.
  it("opens the dialog and accepts a number from the keyboard alone", async () => {
    const api = stubApi(true);
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=join-review-j1]")!.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=join-dialog]")).toBeTruthy();

    await chooseOption(el.shadowRoot!.querySelector("[data-test=join-profile]")!, "dp3");
    await el.updateComplete;
    await chooseOption(el.shadowRoot!.querySelector("[data-test=join-binding]")!, "station:s1");
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLElement>('[data-choice="47"]')!.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);

    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("j1", {
      choice: "47",
      profileId: "dp3",
      stationId: "s1",
    });
  });
});
