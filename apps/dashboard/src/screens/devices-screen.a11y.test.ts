import { expect, afterEach, describe, it, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
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
} from "../api/client.js";

/**
 * The Devices screen scanned by axe in both themes, in four states: the default list (each active row
 * carrying its hardware editor) with the pairing window shut and a device waiting to join, a row's
 * hardware editor with the Stripe Terminal reader field revealed, the pairing window OPEN, and the
 * accept dialog with its three number buttons. Mounted by ASSIGNING the `api` STUB as a property (never
 * bare markup), exactly as the sibling screen a11y suites do: `connectedCallback` fires
 * `void this.#load()` → the list verbs, so the stub must resolve them all or a stray rejection pollutes
 * the run (a rejection is a finding).
 *
 * The last block is not about theme: it pins that each number button carries a real accessible NAME
 * ("Number 47", never a bare "47" — design §1.2 wants the comparison to be a deliberate act), and that
 * the dialog can be both reached and operated from the keyboard alone.
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
  { id: "dp3", name: "Pass screen", canvasId: null, capabilities: [], formFactor: "kds" },
];

const tills: Till[] = [{ id: "t1", label: "Caja 1", locationId: "l1", receiptPrinterId: null }];

const pending: JoinRequestRow[] = [
  { id: "j1", kind: "device", label: "Pantalla pase", createdAt: "2026-09-08T10:02:00.000Z" },
];

const CHOICES = ["12", "47", "83"];

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

function stubApi(pairingOpen = false): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue(devices),
    listStations: vi.fn().mockResolvedValue(stations),
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
    const profile = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=join-profile]")!;
    profile.value = "dp3";
    profile.dispatchEvent(new Event("change"));
    await el.updateComplete;
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
    const profile = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=join-profile]")!;
    profile.value = "dp3";
    profile.dispatchEvent(new Event("change"));
    await el.updateComplete;
    const station = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=join-station]")!;
    station.value = "s1";
    station.dispatchEvent(new Event("change"));
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

    const profile = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=join-profile]")!;
    profile.value = "dp3";
    profile.dispatchEvent(new Event("change"));
    await el.updateComplete;
    const station = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=join-station]")!;
    station.value = "s1";
    station.dispatchEvent(new Event("change"));
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
