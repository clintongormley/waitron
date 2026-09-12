import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type {
  DashboardApi,
  DeviceProfile,
  DeviceRow,
  JoinRequestRow,
  Printer,
  Station,
  Till,
} from "../api/client.js";
import { DevicesScreen } from "./devices-screen.js";

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

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
    label: "Pase revocado",
    active: false,
    lastSeenAt: null,
    enrolledAt: "2026-08-19T09:00:00.000Z",
    deviceProfileId: null,
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
  },
  {
    id: "dp2",
    name: "Waiter handheld",
    canvasId: "p2",
    capabilities: [],
    formFactor: "phone-portrait",
    inactivityTimeoutSeconds: null,
  },
  {
    id: "dp3",
    name: "Pass screen",
    canvasId: null,
    capabilities: [],
    formFactor: "kds",
    inactivityTimeoutSeconds: null,
  },
];

const tills: Till[] = [{ id: "t1", label: "Caja 1", locationId: "l1", receiptPrinterId: null }];

const pending: JoinRequestRow[] = [
  { id: "j1", kind: "device", label: "Pantalla pase", createdAt: "2026-09-08T10:02:00.000Z" },
];

/** The three numbers the server offers for `j1`, shuffled, one of them real — and which one that is.
 * The dashboard is never told, so the test knowing it is the only way to check that the pending LIST
 * does not carry it. */
const CHOICES = ["12", "47", "83"];
const REAL_NUMBER = "47";

const SHUT = { open: false, openUntil: null, refusedRecently: 0 };
const OPEN = { open: true, openUntil: "2026-09-08T10:20:00.000Z", refusedRecently: 0 };

const printers: Printer[] = [
  {
    id: "pr1",
    name: "Cocina",
    transport: "network_tcp",
    pendingJobs: 0,
    lastPrintAt: null,
    host: "10.0.0.9",
    port: 9100,
    localKey: null,
    pollId: null,
    ticketScope: "station",
    active: true,
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue(devices),
    listStations: vi.fn().mockResolvedValue(stations),
    listDeviceProfiles: vi.fn().mockResolvedValue(deviceProfiles),
    listPrinters: vi.fn().mockResolvedValue(printers),
    listTills: vi.fn().mockResolvedValue(tills),
    pairingMode: vi.fn().mockResolvedValue(SHUT),
    openPairingMode: vi.fn().mockResolvedValue({ openUntil: OPEN.openUntil }),
    closePairingMode: vi.fn().mockResolvedValue(undefined),
    joinRequests: vi.fn().mockResolvedValue(pending),
    joinChallenge: vi.fn().mockResolvedValue({ choices: CHOICES }),
    denyJoinRequest: vi.fn().mockResolvedValue(undefined),
    acceptDeviceJoinRequest: vi
      .fn()
      .mockResolvedValue({ deviceId: "j1", name: "Pantalla pase", formFactor: "kds" }),
    revokeDevice: vi.fn().mockResolvedValue(undefined),
    reassignDeviceProfile: vi.fn().mockResolvedValue(undefined),
    // Reflect back the patched fields (the way the server returns the updated device) so the editor's
    // controls can show what took.
    patchDeviceHardware: vi.fn().mockImplementation(
      (
        id: string,
        patch: {
          receiptPrinterId?: string | null;
          hasCashDrawer?: boolean;
        },
      ) =>
        Promise.resolve({
          id,
          receiptPrinterId: patch.receiptPrinterId ?? null,
          hasCashDrawer: patch.hasCashDrawer ?? false,
        }),
    ),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight load (the four list verbs) and the follow-up render. */
async function flush(el: DevicesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: DevicesScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const text = (el: DevicesScreen, sel: string) => q(el, sel)?.textContent?.trim();

/** Pick a value in one of the native <select>s and fire its `change`. */
function pickSelect(el: DevicesScreen, testId: string, value: string): void {
  const select = q(el, `[data-test=${testId}]`) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

/** Toggle a has-cash-drawer wt-switch by dispatching its composed `wt-change` (the wt-switch contract). */
function toggleCashDrawer(el: DevicesScreen, testId: string, checked: boolean): void {
  q(el, `[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
}

describe("devices-screen", () => {
  it("loads every feed the screen needs on connect and renders a row per device", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(api.listDevices).toHaveBeenCalledTimes(1);
    expect(api.listStations).toHaveBeenCalledTimes(1);
    // Profiles/printers feed the row labelling and the hardware editor; stations and tills are also
    // the accept dialog's binding pickers, so they are one load, not two.
    expect(api.listDeviceProfiles).toHaveBeenCalledTimes(1);
    expect(api.listPrinters).toHaveBeenCalledTimes(1);
    expect(api.listTills).toHaveBeenCalledTimes(1);
    expect(api.pairingMode).toHaveBeenCalledTimes(1);
    expect(api.joinRequests).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=device-row-d1]")).toBeTruthy();
    expect(q(el, "[data-test=device-row-d2]")).toBeTruthy();
  });

  it("shows label, profile name, resolved station name, active status and formatted last-seen", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=device-label-d1]")).toBe("Pantalla Cocina");
    // The deviceProfileId resolves to the profile's display name, not the raw id.
    expect(text(el, "[data-test=device-profile-d1]")).toBe("Counter till");
    // The stationId resolves to the loaded station's display name, not the raw id.
    expect(text(el, "[data-test=device-station-d1]")).toBe("Cocina");
    expect(text(el, "[data-test=device-status-d1]")).toBe(t("devices.status_active", "es-ES"));
    // Last-seen is the timestamp formatted to the minute, not the raw ISO string.
    expect(text(el, "[data-test=device-last-seen-d1]")).toBe("2026-08-25 14:30");
  });

  it("resolves a null profile/station to the neutral placeholder and a null last-seen to Never", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=device-profile-d2]")).toBe(
      t("devices.device_profile_none", "es-ES"),
    );
    expect(text(el, "[data-test=device-station-d2]")).toBe(t("devices.no_station", "es-ES"));
    expect(text(el, "[data-test=device-last-seen-d2]")).toBe(t("devices.last_seen_never", "es-ES"));
    expect(text(el, "[data-test=device-status-d2]")).toBe(t("devices.status_revoked", "es-ES"));
  });

  it("falls back to the neutral placeholder for a device bound to a station not in the active list", async () => {
    // A device bound to a since-retired station: listStations (active only) does not carry it, so the
    // name cannot be resolved — the row shows the same neutral placeholder as an unbound device.
    const orphan: DeviceRow = { ...devices[0], id: "d3", stationId: "gone" };
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([orphan]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=device-station-d3]")).toBe(t("devices.no_station", "es-ES"));
  });

  it("shows the empty placeholder when there are no devices", async () => {
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=no-devices]")).toBe(t("devices.no_devices", "es-ES"));
  });

  // #load's guard: a rejected initial load must become the error banner, never an unhandled rejection.
  it("shows an error banner when the initial load is rejected (and never rejects)", async () => {
    const api = stubApi({ listDevices: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("server.internal", "es-ES"));
    expect(banner).not.toContain("server.internal");
  });

  it("falls back to server.internal when the rejected load carries no code", async () => {
    const api = stubApi({ listStations: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  // ── The pairing window (device-join-and-accept §1.1) ───────────────────────────────────────────

  it("shows the shut window's Open control, with the refused-knock hint", async () => {
    const api = stubApi({
      pairingMode: vi.fn().mockResolvedValue({ ...SHUT, refusedRecently: 2 }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=pairing-open]")).toBeTruthy();
    expect(q(el, "[data-test=pairing-until]")).toBeNull();
    // The count is composed into the copy at the render edge (this catalogue has no interpolation).
    expect(text(el, "[data-test=pairing-refused]")).toBe(
      t("devices.pairing_refused", "es-ES").replace("{count}", "2"),
    );
  });

  it("hides the refused-knock hint when nothing was turned away", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=pairing-refused]")).toBeNull();
  });

  it("opens the window and shows when it lapses", async () => {
    const pairingMode = vi.fn().mockResolvedValueOnce(SHUT).mockResolvedValue(OPEN);
    const api = stubApi({ pairingMode });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=pairing-open]")!.click();
    await flush(el);

    expect(api.openPairingMode).toHaveBeenCalledWith();
    expect(text(el, "[data-test=pairing-until]")).toBe(
      t("devices.pairing_open_until", "es-ES").replace("{time}", "2026-09-08 10:20"),
    );
    expect(q(el, "[data-test=pairing-open]")).toBeNull();
  });

  // Extend is the SAME call as Open — the route moves an open window's lapse rather than adding one.
  it("extends and closes an open window", async () => {
    const api = stubApi({ pairingMode: vi.fn().mockResolvedValue(OPEN) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=pairing-extend]")!.click();
    await flush(el);
    expect(api.openPairingMode).toHaveBeenCalledWith();

    q(el, "[data-test=pairing-close]")!.click();
    await flush(el);
    expect(api.closePairingMode).toHaveBeenCalledWith();
  });

  it("shows an error banner when opening the window is rejected", async () => {
    const api = stubApi({
      openPairingMode: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=pairing-open]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "authorization.not_permitted",
    );
  });

  // ── The pending queue (device-join-and-accept §1.2) ────────────────────────────────────────────

  it("lists the pending requests by the name the device asked for", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(api.joinRequests).toHaveBeenCalledWith("device");
    expect(text(el, "[data-test=join-label-j1]")).toBe("Pantalla pase");
    expect(text(el, "[data-test=join-asked-j1]")).toBe("2026-09-08 10:02");
  });

  // Design §1.2 rule 1: the list must never show the answer beside the question. Asserted against the
  // SPECIFIC number this fake server holds — a blanket /\d{2}/ would trip on the row's own timestamp
  // and could never pass — over the panel's rendered TEXT, plus the fact that nothing fetched a
  // challenge to render the list. Not `innerHTML`: lit stamps a per-run random marker comment into
  // every template, and one containing the digits "47" failed this test once for that reason alone.
  it("never renders the request's verification number in the pending list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    const panel = q(el, "[data-test=join-panel]")!;
    expect(panel.textContent).toContain("Pantalla pase");
    expect(panel.textContent).not.toContain(REAL_NUMBER);
    expect(panel.querySelectorAll("[data-choice]")).toHaveLength(0);
    expect(api.joinChallenge).not.toHaveBeenCalled();
  });

  it("shows the empty placeholder when nothing is waiting to join", async () => {
    const api = stubApi({ joinRequests: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=no-join-requests]")).toBe(t("devices.join_none", "es-ES"));
  });

  it("denies only on the confirming second click, then reloads the queue", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=join-deny-j1]")!.click();
    await el.updateComplete;
    expect(api.denyJoinRequest).not.toHaveBeenCalled();
    expect(text(el, "[data-test=join-deny-j1]")).toBe(t("devices.join_deny_confirm", "es-ES"));

    q(el, "[data-test=join-deny-j1]")!.click();
    await flush(el);
    expect(api.denyJoinRequest).toHaveBeenCalledWith("j1");
    expect(api.joinRequests).toHaveBeenCalledTimes(2);
  });

  // ── The accept dialog's numeric match ──────────────────────────────────────────────────────────

  it("opens a row and renders the three numbers as buttons", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    expect(api.joinChallenge).toHaveBeenCalledWith("j1");
    const buttons = Array.from(el.shadowRoot!.querySelectorAll("[data-choice]"));
    expect(buttons.map((b) => b.getAttribute("data-choice"))).toEqual(CHOICES);
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(CHOICES);
  });

  // The numbers stay untappable until the binding is complete, so a tap is always a decision about
  // the number and never an accidental accept with the wrong profile.
  it("keeps the number buttons disabled until the profile and its binding are chosen", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    const choice = () => q(el, `[data-choice="${REAL_NUMBER}"]`) as import("@waitron/ui").WtButton;
    expect(choice().disabled).toBe(true);

    // A kds profile needs a station too: choosing the profile alone is not enough.
    pickSelect(el, "join-profile", "dp3");
    await el.updateComplete;
    expect(choice().disabled).toBe(true);

    pickSelect(el, "join-station", "s1");
    await el.updateComplete;
    expect(choice().disabled).toBe(false);
  });

  // A till profile binds NEITHER picker — the server creates the register the device rings against.
  it("shows no station or register picker for a till profile", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    pickSelect(el, "join-profile", "dp1");
    await el.updateComplete;

    expect(q(el, "[data-test=join-station]")).toBeNull();
    expect(q(el, "[data-test=join-register]")).toBeNull();
    expect(
      (q(el, `[data-choice="${REAL_NUMBER}"]`) as import("@waitron/ui").WtButton).disabled,
    ).toBe(false);
  });

  it("offers the register picker for a handheld profile and posts the chosen register", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    pickSelect(el, "join-profile", "dp2");
    await el.updateComplete;
    expect(q(el, "[data-test=join-station]")).toBeNull();
    pickSelect(el, "join-register", "t1");
    await el.updateComplete;
    q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
    await flush(el);

    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("j1", {
      choice: REAL_NUMBER,
      profileId: "dp2",
      registerId: "t1",
    });
  });

  it("accepts with the tapped number, then closes the dialog and reloads both lists", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);
    pickSelect(el, "join-profile", "dp3");
    await el.updateComplete;
    pickSelect(el, "join-station", "s1");
    await el.updateComplete;

    q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
    await flush(el);

    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("j1", {
      choice: REAL_NUMBER,
      profileId: "dp3",
      stationId: "s1",
    });
    expect(q(el, "[data-test=join-dialog]")).toBeNull();
    expect(api.listDevices).toHaveBeenCalledTimes(2);
    expect(api.joinRequests).toHaveBeenCalledTimes(2);
  });

  // Design §1.2: a wrong tap has ALREADY denied the request server-side. It is terminal for the row —
  // the dialog closes, the row is gone, and the copy sends the operator back to the device. Proven by
  // deletion: drop the `device.join_mismatch` branch in #accept and this fails.
  it("treats a mismatch as terminal: the row goes, and the operator is told to ask again", async () => {
    const api = stubApi({
      acceptDeviceJoinRequest: vi.fn().mockRejectedValue({ code: "device.join_mismatch" }),
      // The server deleted the request before answering, so the refreshed queue is empty.
      joinRequests: vi.fn().mockResolvedValueOnce(pending).mockResolvedValue([]),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);
    pickSelect(el, "join-profile", "dp3");
    await el.updateComplete;
    pickSelect(el, "join-station", "s1");
    await el.updateComplete;

    q(el, '[data-choice="12"]')!.click();
    await flush(el);

    expect(q(el, "[data-test=join-row-j1]")).toBeNull();
    expect(q(el, "[data-test=join-dialog]")).toBeNull();
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("device.join_mismatch", "es-ES"));
    expect(banner).not.toContain("device.join_mismatch");
  });

  // The counterpart that gives the mismatch branch its meaning: a fault the operator CAN fix leaves
  // the dialog open on the same request, so they can correct the binding and tap again.
  it("keeps the dialog open on a recoverable accept fault", async () => {
    const api = stubApi({
      acceptDeviceJoinRequest: vi.fn().mockRejectedValue({ code: "device.station_required" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);
    pickSelect(el, "join-profile", "dp3");
    await el.updateComplete;
    pickSelect(el, "join-station", "s1");
    await el.updateComplete;

    q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
    await flush(el);

    expect(q(el, "[data-test=join-dialog]")).toBeTruthy();
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("device.station_required");
  });

  it("reopens a row without re-fetching its numbers — the set is fixed server-side", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);
    q(el, "[data-test=join-cancel]")!.click();
    await el.updateComplete;
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    expect(api.joinChallenge).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelectorAll("[data-choice]")).toHaveLength(3);
  });

  it("shows an error banner when the challenge fetch is rejected", async () => {
    const api = stubApi({
      joinChallenge: vi.fn().mockRejectedValue({ code: "join_request.not_found" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("join_request.not_found");
  });

  // The generate-code panel and its verb are gone: a device is created by ACCEPTING a request now.
  it("shows none of the retired generate-code controls", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=generate]")).toBeNull();
    expect(q(el, "[data-test=code-panel]")).toBeNull();
    expect(q(el, "[data-test=copy-code]")).toBeNull();
  });

  // ── Revoke + reassign (unchanged row controls) ─────────────────────────────────────────────────

  it("does not show the revoke / reassign / hardware controls for an already-revoked device", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=revoke-d1]")).toBeTruthy(); // active
    expect(q(el, "[data-test=reassign-d1]")).toBeTruthy();
    expect(q(el, "[data-test=hardware-d1]")).toBeTruthy();
    expect(q(el, "[data-test=revoke-d2]")).toBeNull(); // revoked
    expect(q(el, "[data-test=reassign-d2]")).toBeNull();
    expect(q(el, "[data-test=hardware-d2]")).toBeNull();
  });

  it("revokes only on the confirming second click, then reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=revoke-d1]")!.click();
    await el.updateComplete;
    expect(api.revokeDevice).not.toHaveBeenCalled();
    expect(text(el, "[data-test=revoke-d1]")).toBe(t("devices.revoke_confirm", "es-ES"));

    q(el, "[data-test=revoke-d1]")!.click();
    await flush(el);
    expect(api.revokeDevice).toHaveBeenCalledWith("d1");
    expect(api.listDevices).toHaveBeenCalledTimes(2);
  });

  it("shows an error and keeps the list when a revoke is rejected", async () => {
    const api = stubApi({ revokeDevice: vi.fn().mockRejectedValue({ code: "device.not_found" }) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=revoke-d1]")!.click();
    await el.updateComplete;
    q(el, "[data-test=revoke-d1]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("device.not_found");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("device.not_found", "es-ES"));
  });

  it("renders a per-row reassign select preselected to the device's current device profile", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    const select = q(el, "[data-test=reassign-d1]") as HTMLSelectElement;
    expect(select).toBeTruthy();
    const options = Array.from(select.querySelectorAll("option"));
    expect(options.map((o) => o.value)).toEqual(["", "dp1", "dp2", "dp3"]);
    expect(options[0]!.textContent?.trim()).toBe(t("devices.device_profile_none", "es-ES"));
    expect(options[1]!.textContent?.trim()).toBe("Counter till");
    expect(select.value).toBe("dp1");
  });

  it("reassigns a device to the picked device profile, then reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickSelect(el, "reassign-d1", "dp2");
    await flush(el);

    expect(api.reassignDeviceProfile).toHaveBeenCalledWith("d1", "dp2");
    expect(api.listDevices).toHaveBeenCalledTimes(2);
  });

  it("clears a device's device profile when Default is picked", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickSelect(el, "reassign-d1", "");
    await flush(el);

    expect(api.reassignDeviceProfile).toHaveBeenCalledWith("d1", null);
  });

  it("shows an error and snaps the reassign select back when a reassign is rejected", async () => {
    const api = stubApi({
      reassignDeviceProfile: vi.fn().mockRejectedValue({ code: "device.binding_invalid" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickSelect(el, "reassign-d1", "dp2");
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("device.binding_invalid");
    const select = q(el, "[data-test=reassign-d1]") as HTMLSelectElement;
    expect(select.value).toBe("dp1");
  });

  // ── Per-device hardware editor (Task 14) ───────────────────────────────────────────────────────

  // A row's hardware editor PATCHes the receipt printer + cash drawer and reflects the stored values.
  // Proven by deletion: drop the patchDeviceHardware call and the API is never hit.
  it("saves a row's edited hardware and reflects the update", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickSelect(el, "hw-printer-d1", "pr1");
    toggleCashDrawer(el, "hw-cash-drawer-d1", true);
    await el.updateComplete;
    q(el, "[data-test=hw-save-d1]")!.click();
    await flush(el);

    expect(api.patchDeviceHardware).toHaveBeenCalledWith("d1", {
      receiptPrinterId: "pr1",
      hasCashDrawer: true,
    });
    // The controls reflect what took: the reconciled select shows the saved value.
    expect((q(el, "[data-test=hw-printer-d1]") as HTMLSelectElement).value).toBe("pr1");
  });

  // A save with the editor left at its defaults sends the cleared hardware: no printer (null) and no
  // cash drawer. Covers the ""→null printer mapping.
  it("saves cleared hardware (nulls) when the editor is left at its defaults", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=hw-save-d1]")!.click();
    await flush(el);

    expect(api.patchDeviceHardware).toHaveBeenCalledWith("d1", {
      receiptPrinterId: null,
      hasCashDrawer: false,
    });
  });

  it("shows an error banner when a hardware save is rejected", async () => {
    const api = stubApi({
      patchDeviceHardware: vi.fn().mockRejectedValue({ code: "device.binding_invalid" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=hw-save-d1]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("device.binding_invalid");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("device.binding_invalid", "es-ES"));
  });

  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-devices-screen")).toBe(DevicesScreen);
  });
});

it("refreshes displayed devices when their data changes elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<HTMLElement & { api: DashboardApi }>(
    "dashboard-devices-screen",
    { api },
  );
  const rows = (): unknown[] => (el as unknown as Record<string, unknown[]>)["devices"]!;
  await vi.waitFor(() => expect(rows()?.length).toBeGreaterThan(0));
  vi.mocked(api.listDevices).mockResolvedValue([]);
  liveData.invalidate([{ type: "devices", id: "changed-elsewhere" }]);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(api.listDevices).toHaveBeenCalledTimes(2);
});
