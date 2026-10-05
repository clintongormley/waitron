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
  Watcher,
} from "../api/client.js";

/**
 * Scanned in the default list, the Add a device dialog (with waiting rows, with none, after its hold
 * lapsed, and after its hold was refused) and both Pair steps. The stub must resolve every list verb or a stray rejection pollutes the run. The
 * last block pins that each number button has a real accessible NAME and that pairing works from the
 * keyboard alone.
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

const pending: JoinRequestRow[] = [
  {
    id: "r1",
    kind: "device",
    label: "Pantalla pase",
    createdAt: "2026-09-08T10:02:00.000Z",
    pairingBy: null,
  },
  {
    id: "r2",
    kind: "device",
    label: "Caja de la terraza",
    createdAt: "2026-09-08T10:03:00.000Z",
    pairingBy: { name: "Ana", mine: false },
  },
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

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue(devices),
    listStations: vi.fn().mockResolvedValue(stations),
    listWatchers: vi.fn().mockResolvedValue(watchers),
    listDeviceProfiles: vi.fn().mockResolvedValue(deviceProfiles),
    listPrinters: vi.fn().mockResolvedValue(printers),
    pairingMode: vi.fn().mockResolvedValue({
      open: false,
      openUntil: null,
      deviceAddress: "https://waitron.local",
    }),
    takePairingHold: vi
      .fn()
      .mockResolvedValue({ holdId: "h1", openUntil: "2026-09-08T10:05:00.000Z" }),
    renewPairingHold: vi.fn().mockResolvedValue({ openUntil: "2026-09-08T10:05:00.000Z" }),
    releasePairingHold: vi.fn().mockResolvedValue(undefined),
    joinRequests: vi.fn().mockResolvedValue(pending),
    joinChallenge: vi.fn().mockResolvedValue({ choices: CHOICES }),
    checkDeviceJoinNumber: vi.fn().mockResolvedValue(undefined),
    denyJoinRequest: vi.fn().mockResolvedValue(undefined),
    acceptDeviceJoinRequest: vi
      .fn()
      .mockResolvedValue({ deviceId: "d9", name: "Pantalla pase", formFactor: "kds" }),
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
    ...overrides,
  } as unknown as DashboardApi;
}

/** Waiting rows are table cells, which live in the table's own shadow root. */
function deep(root: ShadowRoot | Element, sel: string): HTMLElement | null {
  const found = root.querySelector<HTMLElement>(sel);
  if (found) return found;
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.shadowRoot) {
      const nested = deep(node.shadowRoot, sel);
      if (nested) return nested;
    }
  }
  return null;
}

async function openAdd(el: DevicesScreen): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=open-add-device]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=device-qr]")?.getAttribute("src")).toBeTruthy(),
  );
  await flush(el);
}

async function openPair(el: DevicesScreen): Promise<void> {
  await vi.waitFor(() => expect(deep(el.shadowRoot!, "[data-test=pair-r1]")).not.toBeNull());
  deep(el.shadowRoot!, "[data-test=pair-r1]")!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-choice]")).not.toBeNull());
  await flush(el);
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

  it.each([390, 1280])(
    "renders the Add a device dialog with waiting rows accessibly at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const { el, host } = await mountWidget<DevicesScreen>(
        "dashboard-devices-screen",
        { api: stubApi() },
        theme,
      );
      await flush(el);
      await openAdd(el);
      await vi.waitFor(() =>
        expect(deep(el.shadowRoot!, "[data-test=being-paired-r2]")).not.toBeNull(),
      );
      await expectNoA11yViolations(host);
      await page.viewport(1280, 900);
    },
  );

  it("renders the Add a device dialog with nothing waiting accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      { api: stubApi({ joinRequests: vi.fn().mockResolvedValue([]) }) },
      theme,
    );
    await flush(el);
    await openAdd(el);
    expect(el.shadowRoot!.querySelector("[data-test=waiting-empty] wt-spinner")).toBeTruthy();
    await expectNoA11yViolations(host);
  });

  // Only the interval timers are faked, so animation frames stay real. The stub has no `background`,
  // so the controller renews through the API itself.
  it("renders the Add a device dialog after its hold lapsed accessibly", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { el, host } = await mountWidget<DevicesScreen>(
        "dashboard-devices-screen",
        {
          api: stubApi({
            renewPairingHold: vi.fn().mockRejectedValue({ code: "device.pairing_hold_lapsed" }),
          }),
        },
        theme,
      );
      await flush(el);
      await openAdd(el);
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() =>
        expect(
          el.shadowRoot!.querySelector("[data-test=hold-lapsed]")?.getAttribute("data-status"),
        ).toBe("lapsed"),
      );
      await flush(el);
      await expectNoA11yViolations(host);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the Add a device dialog after its hold was refused accessibly", async () => {
    const { el, host } = await mountWidget<DevicesScreen>(
      "dashboard-devices-screen",
      {
        api: stubApi({ takePairingHold: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=open-add-device]")!.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector("[data-test=hold-lapsed]")?.getAttribute("data-status"),
      ).toBe("failed"),
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it.each([390, 1280])(
    "renders the Pair dialog's number step accessibly at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const { el, host } = await mountWidget<DevicesScreen>(
        "dashboard-devices-screen",
        { api: stubApi() },
        theme,
      );
      await flush(el);
      await openAdd(el);
      await openPair(el);
      await expectNoA11yViolations(host);
      await page.viewport(1280, 900);
    },
  );

  it.each([390, 1280])(
    "renders the Pair dialog's settings step with a Name error accessibly at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const { el, host } = await mountWidget<DevicesScreen>(
        "dashboard-devices-screen",
        {
          api: stubApi({
            acceptDeviceJoinRequest: vi.fn().mockRejectedValue({ code: "device.name_taken" }),
          }),
        },
        theme,
      );
      await flush(el);
      await openAdd(el);
      await openPair(el);
      el.shadowRoot!.querySelector<HTMLElement>('[data-choice="47"]')!.click();
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=pair-profile]")).not.toBeNull(),
      );
      await chooseOption(el.shadowRoot!.querySelector("[data-test=pair-profile]")!, "dp3");
      await el.updateComplete;
      const binding = el.shadowRoot!.querySelector("[data-test=pair-binding]")!;
      await chooseOption(binding, "station:s1");
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=pair-submit]")!.click();
      await vi.waitFor(() =>
        expect(
          (el.shadowRoot!.querySelector("[data-test=pair-name]") as HTMLElement & { error: string })
            .error,
        ).not.toBe(""),
      );
      await flush(el);
      await userEvent.click(binding.shadowRoot!.querySelector(".trigger")!);
      expect(
        Array.from(binding.shadowRoot!.querySelectorAll(".group-heading")).map((group) =>
          group.textContent?.trim(),
        ),
      ).toEqual(["Estaciones", "Puntos de seguimiento"]);
      await userEvent.keyboard("{Escape}");
      await flush(el);
      await expectNoA11yViolations(host);
      await page.viewport(1280, 900);
    },
  );
});

describe("devices-screen a11y — the numeric match", () => {
  // A bare "47" is not a name a screen reader can act on — the number has to be announced as one.
  // Read off the INNER <button>, which is the element that actually carries the name (wt-button
  // forwards `aria-label` into its shadow root).
  it("names every number button, not just labels it with the digits", async () => {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api: stubApi(),
    });
    await flush(el);
    await openAdd(el);
    await openPair(el);
    const names = Array.from(el.shadowRoot!.querySelectorAll("[data-choice]")).map((b) =>
      b.shadowRoot!.querySelector("button")!.getAttribute("aria-label"),
    );
    expect(names).toEqual(
      CHOICES.map((n) => t("devices.join_choice_label", "es-ES").replace("{number}", n)),
    );
  });

  // Reachable AND operable from the keyboard alone: Enter on the focused Pair opens the dialog, Enter
  // on a focused number checks it, and Enter in the name field pairs. Real key events.
  it("pairs a device from the keyboard alone", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    await openAdd(el);
    await vi.waitFor(() => expect(deep(el.shadowRoot!, "[data-test=pair-r1]")).not.toBeNull());

    deep(el.shadowRoot!, "[data-test=pair-r1]")!.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-choice]")).not.toBeNull());
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>('[data-choice="47"]')!.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=pair-name]")).not.toBeNull(),
    );
    expect(api.checkDeviceJoinNumber).toHaveBeenCalledWith("r1", { choice: "47", holdId: "h1" });

    await chooseOption(el.shadowRoot!.querySelector("[data-test=pair-profile]")!, "dp1");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=pair-name]")!.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("r1", {
        name: "Pantalla pase",
        profileId: "dp1",
      }),
    );
  });
});
