import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { DashboardApi, DeviceRow, Station } from "../api/client.js";
import { DevicesScreen } from "./devices-screen.js";

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

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
    label: "Pase revocado",
    active: false,
    lastSeenAt: null,
    enrolledAt: "2026-08-19T09:00:00.000Z",
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue(devices),
    listStations: vi.fn().mockResolvedValue(stations),
    createDeviceCode: vi.fn().mockResolvedValue({ code: "ABCD2345" }),
    revokeDevice: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight load (listDevices + listStations) and the follow-up render. */
async function flush(el: DevicesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: DevicesScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const text = (el: DevicesScreen, sel: string) => q(el, sel)?.textContent?.trim();

/** Type into the label field by dispatching its composed `wt-change` (the wt-input contract). */
function typeLabel(el: DevicesScreen, value: string): void {
  q(el, "[data-test=code-label]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

/** Pick a station in the native <select> and fire its `change`. */
function pickStation(el: DevicesScreen, value: string): void {
  const select = q(el, "[data-test=station-select]") as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

/** Pick a device kind in the native <select> and fire its `change`. */
function pickKind(el: DevicesScreen, value: string): void {
  const select = q(el, "[data-test=kind-select]") as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

describe("devices-screen", () => {
  it("loads devices and stations on connect and renders a row per device", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(api.listDevices).toHaveBeenCalledTimes(1);
    expect(api.listStations).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=device-row-d1]")).toBeTruthy();
    expect(q(el, "[data-test=device-row-d2]")).toBeTruthy();
  });

  it("shows label, resolved station name, active status and formatted last-seen for an active device", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=device-label-d1]")).toBe("Pantalla Cocina");
    // The station id resolves to the loaded station's display name, not the raw id.
    expect(text(el, "[data-test=device-station-d1]")).toBe("Cocina");
    expect(text(el, "[data-test=device-status-d1]")).toBe(t("devices.status_active", "es-ES"));
    // Last-seen is the timestamp formatted to the minute, not the raw ISO string.
    expect(text(el, "[data-test=device-last-seen-d1]")).toBe("2026-08-25 14:30");
  });

  it("resolves a null stationId to the neutral placeholder and a null last-seen to Never", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

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

  // #load's guard: a rejected initial load must become the error banner, never an unhandled rejection
  // (the suite runs with pristine output). The banner renders LOCALISED copy, never the raw wire code.
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

  it("generates a pairing code for the picked station + label, shows it once, and reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickStation(el, "s2");
    typeLabel(el, "Nueva pantalla");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect(api.createDeviceCode).toHaveBeenCalledWith({
      kind: "kds_station",
      stationId: "s2",
      label: "Nueva pantalla",
    });
    // The code is shown ONCE, in a prominent copyable panel.
    expect(q(el, "[data-test=code-panel]")).toBeTruthy();
    expect(text(el, "[data-test=code-value]")).toBe("ABCD2345");
    // Generating reloads the device list so the new device appears.
    expect(api.listDevices).toHaveBeenCalledTimes(2);
  });

  // Picking the handheld kind HIDES the station picker (a handheld binds to no station) and mints a
  // station-less code: the body carries `{ kind: "handheld", label }` with NO stationId. Proven by
  // deletion: without the kind-gated branch #generate always sends kds_station + stationId.
  it("generates a handheld code with no station picker", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickKind(el, "handheld");
    await el.updateComplete;
    // The station picker is gone once the kind is a handheld.
    expect(q(el, "[data-test=station-select]")).toBeNull();

    typeLabel(el, "Waiter phone");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect(api.createDeviceCode).toHaveBeenCalledWith({ kind: "handheld", label: "Waiter phone" });
    expect(q(el, "[data-test=code-panel]")).toBeTruthy();
    expect(text(el, "[data-test=code-value]")).toBe("ABCD2345");
    expect(api.listDevices).toHaveBeenCalledTimes(2);
  });

  // A handheld needs no station, so an empty station set (nothing to bind to) does NOT block a handheld
  // generate — the station guard applies only to the kds_station kind.
  it("generates a handheld code even with no stations configured", async () => {
    const api = stubApi({ listStations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickKind(el, "handheld");
    await el.updateComplete;
    typeLabel(el, "Waiter phone");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect(api.createDeviceCode).toHaveBeenCalledWith({ kind: "handheld", label: "Waiter phone" });
  });

  it("uses the first station by default when the picker is left untouched", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    typeLabel(el, "Cocina 2");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect(api.createDeviceCode).toHaveBeenCalledWith({
      kind: "kds_station",
      stationId: "s1",
      label: "Cocina 2",
    });
  });

  // The generate guard: a blank (whitespace-only) label is a no-op, so no code is minted.
  it("does not generate when the label is blank", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    typeLabel(el, "   ");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect(api.createDeviceCode).not.toHaveBeenCalled();
    expect(q(el, "[data-test=code-panel]")).toBeNull();
  });

  // The generate guard: with no stations configured there is nothing to bind a code to, so generate is
  // a no-op even with a label (covers the empty-stations seed-skip + the no-station generate guard).
  it("does not generate when there are no stations to bind to", async () => {
    const api = stubApi({ listStations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    typeLabel(el, "Cocina");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect(api.createDeviceCode).not.toHaveBeenCalled();
  });

  // The code is shown ONCE and is NOT re-fetchable: dismissing clears it from state, and nothing
  // re-requests it. Prove by deletion: stop clearing generatedCode in #dismissCode and the panel stays.
  it("clears the shown-once code on dismiss and never re-fetches it", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    typeLabel(el, "Pantalla");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);
    expect(q(el, "[data-test=code-panel]")).toBeTruthy();

    q(el, "[data-test=dismiss-code]")!.click();
    await el.updateComplete;

    expect(q(el, "[data-test=code-panel]")).toBeNull();
    // Dismissing does not re-request the code (it lived only in component state).
    expect(api.createDeviceCode).toHaveBeenCalledTimes(1);
  });

  it("copies the shown code to the clipboard and confirms with a Copied status", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    typeLabel(el, "Pantalla");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    q(el, "[data-test=copy-code]")!.click();
    await flush(el);

    expect(writeText).toHaveBeenCalledWith("ABCD2345");
    expect(text(el, "[data-test=copied]")).toBe(t("devices.copied", "es-ES"));
  });

  // The copy path must never throw when the clipboard is unavailable/denied — the code stays visible to
  // copy by hand. Covers the catch arm: no Copied status appears.
  it("does not throw or confirm when the clipboard write is rejected", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    typeLabel(el, "Pantalla");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    q(el, "[data-test=copy-code]")!.click();
    await flush(el);

    expect(q(el, "[data-test=copied]")).toBeNull();
    // The code panel is still on screen for a manual copy.
    expect(q(el, "[data-test=code-panel]")).toBeTruthy();
  });

  // A rejected generate becomes the error banner, shows no code panel and does NOT reload the list, so
  // the operator keeps the form and can retry. Covers the `.code` catch arm.
  it("shows an error and no code panel when generate is rejected", async () => {
    const api = stubApi({
      createDeviceCode: vi.fn().mockRejectedValue({ code: "station.not_found" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    typeLabel(el, "Pantalla");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("station.not_found");
    expect(q(el, "[data-test=code-panel]")).toBeNull();
    expect(api.listDevices).toHaveBeenCalledTimes(1); // NOT reloaded
  });

  it("does not show a revoke control for an already-revoked device", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=revoke-d1]")).toBeTruthy(); // active device
    expect(q(el, "[data-test=revoke-d2]")).toBeNull(); // already revoked
  });

  // Revoke is a TWO-STEP confirm: the first click ARMS the row (label → confirm prompt) and does NOT
  // call the API; a second click on the armed control revokes and reloads. Proven by deletion: drop the
  // arm branch and the first click revokes immediately.
  it("revokes only on the confirming second click, then reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    // First click arms — no API call yet, label flips to the confirm prompt.
    q(el, "[data-test=revoke-d1]")!.click();
    await el.updateComplete;
    expect(api.revokeDevice).not.toHaveBeenCalled();
    expect(text(el, "[data-test=revoke-d1]")).toBe(t("devices.revoke_confirm", "es-ES"));

    // Second click confirms.
    q(el, "[data-test=revoke-d1]")!.click();
    await flush(el);
    expect(api.revokeDevice).toHaveBeenCalledWith("d1");
    expect(api.listDevices).toHaveBeenCalledTimes(2); // reloaded
  });

  // The post-mutation reload disarms any armed revoke (mirroring #load): arming a revoke on one row then
  // GENERATING a code must clear the armed state, so a stray armed row cannot survive an unrelated action.
  // Proven by deletion: drop `this.armedRevokeId = null` from #reloadDevices and the row stays armed after
  // generate (the assertions below flip red).
  it("generating a code disarms an armed revoke", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    // Arm the revoke on d1 (first click) — the control flips to the confirm prompt.
    q(el, "[data-test=revoke-d1]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=revoke-d1]")!.getAttribute("data-armed")).toBe("true");
    expect((el as unknown as { armedRevokeId: string | null }).armedRevokeId).toBe("d1");

    // Generate a pairing code (station seeded to s1 on load) — its devices reload must disarm the row.
    typeLabel(el, "Pantalla Barra");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect(api.createDeviceCode).toHaveBeenCalledTimes(1);
    expect((el as unknown as { armedRevokeId: string | null }).armedRevokeId).toBeNull();
    // The row's control reverted to the plain Revoke label, no longer the confirm prompt.
    expect(q(el, "[data-test=revoke-d1]")!.getAttribute("data-armed")).toBeNull();
    expect(text(el, "[data-test=revoke-d1]")).toBe(t("devices.revoke", "es-ES"));
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

  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-devices-screen")).toBe(DevicesScreen);
  });
});
