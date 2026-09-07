import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { DashboardApi, DeviceProfile, DeviceRow, Printer, Station } from "../api/client.js";
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

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue(devices),
    listStations: vi.fn().mockResolvedValue(stations),
    listDeviceProfiles: vi.fn().mockResolvedValue(deviceProfiles),
    listPrinters: vi.fn().mockResolvedValue(printers),
    createDeviceCode: vi.fn().mockResolvedValue({ code: "ABCD2345" }),
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
          cardProvider?: string;
          cardReaderId?: string | null;
        },
      ) =>
        Promise.resolve({
          id,
          receiptPrinterId: patch.receiptPrinterId ?? null,
          hasCashDrawer: patch.hasCashDrawer ?? false,
          cardProvider: patch.cardProvider ?? "none",
          cardReaderId: patch.cardReaderId ?? null,
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

/** Type into a card-reader wt-input by dispatching its composed `wt-change` (the wt-input contract). */
function typeCardReader(el: DevicesScreen, testId: string, value: string): void {
  q(el, `[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

describe("devices-screen", () => {
  it("loads devices, stations, profiles and printers on connect and renders a row per device", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(api.listDevices).toHaveBeenCalledTimes(1);
    expect(api.listStations).toHaveBeenCalledTimes(1);
    // The row labelling (profile name) and the hardware editor (printers) are fed from these two verbs;
    // the collapsed generate form no longer needs a tills feed.
    expect(api.listDeviceProfiles).toHaveBeenCalledTimes(1);
    expect(api.listPrinters).toHaveBeenCalledTimes(1);
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

  // The generate form collapsed to ONE button: it mints a BARE enrolment key (no body — the device
  // describes itself at enrolment), shows it once and reloads the list. Proven by deletion: drop the
  // createDeviceCode call and no code appears.
  it("generates an enrolment key with no body, shows it once, and reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect(api.createDeviceCode).toHaveBeenCalledWith();
    expect(q(el, "[data-test=code-panel]")).toBeTruthy();
    expect(text(el, "[data-test=code-value]")).toBe("ABCD2345");
    // Generating reloads the device list so a newly-enrolled device appears.
    expect(api.listDevices).toHaveBeenCalledTimes(2);
  });

  // The kind/station/till/label/profile pickers of the old generate form are gone — the code is a bare
  // token now, so the form is a single button.
  it("shows none of the old generate-form fields", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=kind-select]")).toBeNull();
    expect(q(el, "[data-test=station-select]")).toBeNull();
    expect(q(el, "[data-test=till-select]")).toBeNull();
    expect(q(el, "[data-test=device-profile-select]")).toBeNull();
    expect(q(el, "[data-test=code-label]")).toBeNull();
    expect(q(el, "[data-test=generate]")).toBeTruthy();
  });

  // The submitting guard: a click while a mint is in flight does not fire a second, and the button is
  // disabled until it settles.
  it("guards a pending generate and re-enables the button afterwards", async () => {
    let resolve!: (value: { code: string }) => void;
    const pending = new Promise<{ code: string }>((ok) => {
      resolve = ok;
    });
    const createDeviceCode = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ code: "X" });
    const api = stubApi({ createDeviceCode });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    const button = () => q(el, "[data-test=generate]") as import("@waitron/ui").WtButton;
    button().click();
    await el.updateComplete;
    expect(button().disabled).toBe(true);
    button().click(); // ignored while submitting
    expect(createDeviceCode).toHaveBeenCalledTimes(1);

    resolve({ code: "ABCD2345" });
    await flush(el);
    expect(button().disabled).toBe(false);
  });

  it("copies the shown code to the clipboard and confirms with a Copied status", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=generate]")!.click();
    await flush(el);
    q(el, "[data-test=copy-code]")!.click();
    await flush(el);

    expect(writeText).toHaveBeenCalledWith("ABCD2345");
    expect(text(el, "[data-test=copied]")).toBe(t("devices.copied", "es-ES"));
  });

  it("does not throw or confirm when the clipboard write is rejected", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=generate]")!.click();
    await flush(el);
    q(el, "[data-test=copy-code]")!.click();
    await flush(el);

    expect(q(el, "[data-test=copied]")).toBeNull();
    expect(q(el, "[data-test=code-panel]")).toBeTruthy();
  });

  it("clears the shown-once code on dismiss and never re-fetches it", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=generate]")!.click();
    await flush(el);
    expect(q(el, "[data-test=code-panel]")).toBeTruthy();

    q(el, "[data-test=dismiss-code]")!.click();
    await el.updateComplete;

    expect(q(el, "[data-test=code-panel]")).toBeNull();
    expect(api.createDeviceCode).toHaveBeenCalledTimes(1);
  });

  it("shows an error and no code panel when generate is rejected", async () => {
    const api = stubApi({
      createDeviceCode: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
    expect(q(el, "[data-test=code-panel]")).toBeNull();
    expect(api.listDevices).toHaveBeenCalledTimes(1); // NOT reloaded
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
    expect(options.map((o) => o.value)).toEqual(["", "dp1", "dp2"]);
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

  // The card-reader field shows ONLY once the provider is a Stripe Terminal reader; a provider that
  // needs no separate reader (stripe_on_device / none) hides it.
  it("shows a row's card-reader field only for the stripe_terminal provider", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=hw-card-reader-d1]")).toBeNull(); // default provider 'none'
    pickSelect(el, "hw-card-provider-d1", "stripe_terminal");
    await el.updateComplete;
    expect(q(el, "[data-test=hw-card-reader-d1]")).toBeTruthy();

    pickSelect(el, "hw-card-provider-d1", "stripe_on_device");
    await el.updateComplete;
    expect(q(el, "[data-test=hw-card-reader-d1]")).toBeNull();
  });

  // A row's hardware editor PATCHes the full hardware set and reflects the server's stored values.
  // Proven by deletion: drop the patchDeviceHardware call and the API is never hit.
  it("saves a row's edited hardware and reflects the update", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickSelect(el, "hw-printer-d1", "pr1");
    toggleCashDrawer(el, "hw-cash-drawer-d1", true);
    pickSelect(el, "hw-card-provider-d1", "stripe_terminal");
    await el.updateComplete;
    typeCardReader(el, "hw-card-reader-d1", "reader-9");
    await el.updateComplete;
    q(el, "[data-test=hw-save-d1]")!.click();
    await flush(el);

    expect(api.patchDeviceHardware).toHaveBeenCalledWith("d1", {
      receiptPrinterId: "pr1",
      hasCashDrawer: true,
      cardProvider: "stripe_terminal",
      cardReaderId: "reader-9",
    });
    // The controls reflect what took: the reconciled selects show the saved values.
    expect((q(el, "[data-test=hw-printer-d1]") as HTMLSelectElement).value).toBe("pr1");
    expect((q(el, "[data-test=hw-card-provider-d1]") as HTMLSelectElement).value).toBe(
      "stripe_terminal",
    );
  });

  // A save with the editor left at its defaults sends the cleared hardware: no printer / reader (null),
  // no cash drawer, provider 'none'. Covers the ""→null / non-terminal-reader→null mapping.
  it("saves cleared hardware (nulls) when the editor is left at its defaults", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=hw-save-d1]")!.click();
    await flush(el);

    expect(api.patchDeviceHardware).toHaveBeenCalledWith("d1", {
      receiptPrinterId: null,
      hasCashDrawer: false,
      cardProvider: "none",
      cardReaderId: null,
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
