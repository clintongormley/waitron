import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type {
  DashboardApi,
  DeviceRow,
  LayoutProfile,
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

const tills: Till[] = [
  { id: "t1", label: "Caja 1", locationId: "loc1", receiptPrinterId: null },
  { id: "t2", label: "Caja 2", locationId: "loc1", receiptPrinterId: null },
];

const profiles: LayoutProfile[] = [
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

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue(devices),
    listStations: vi.fn().mockResolvedValue(stations),
    listTills: vi.fn().mockResolvedValue(tills),
    listProfiles: vi.fn().mockResolvedValue(profiles),
    listPrinters: vi.fn().mockResolvedValue(printers),
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

/** Pick a value in one of the native <select>s (till/profile/printer/card-provider) and fire `change`. */
function pickSelect(el: DevicesScreen, testId: string, value: string): void {
  const select = q(el, `[data-test=${testId}]`) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

/** Toggle the has-cash-drawer wt-switch by dispatching its composed `wt-change` (the wt-switch contract). */
function toggleCashDrawer(el: DevicesScreen, checked: boolean): void {
  q(el, "[data-test=cash-drawer-switch]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
}

/** Type into the card-reader wt-input by dispatching its composed `wt-change` (the wt-input contract). */
function typeCardReader(el: DevicesScreen, value: string): void {
  q(el, "[data-test=card-reader-id]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

describe("devices-screen", () => {
  it("loads devices and stations on connect and renders a row per device", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(api.listDevices).toHaveBeenCalledTimes(1);
    expect(api.listStations).toHaveBeenCalledTimes(1);
    // The generate form's till/profile/hardware pickers are fed from these three list verbs.
    expect(api.listTills).toHaveBeenCalledTimes(1);
    expect(api.listProfiles).toHaveBeenCalledTimes(1);
    expect(api.listPrinters).toHaveBeenCalledTimes(1);
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

  // Picking the handheld kind HIDES the station picker (a handheld binds to no station) but a handheld is
  // sale-capable, so the server now REQUIRES a till (device.till_required otherwise): the till picker
  // shows and the body carries `{ kind: "handheld", tillId, label }` with the seeded first till, NO
  // stationId, and NO hardware bindings (those are the till kind's). Proven by deletion: drop the
  // kind-gated till branch and #generate sends no tillId, which the server rejects.
  it("generates a handheld code — till picker shown (no station, no hardware), tillId sent", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickKind(el, "handheld");
    await el.updateComplete;
    // The station picker is gone once the kind is a handheld; the till picker takes its place.
    expect(q(el, "[data-test=station-select]")).toBeNull();
    expect(q(el, "[data-test=till-select]")).toBeTruthy();
    // A handheld carries no hardware bindings — those pickers are the till kind's only.
    expect(q(el, "[data-test=receipt-printer-select]")).toBeNull();
    expect(q(el, "[data-test=cash-drawer-switch]")).toBeNull();
    expect(q(el, "[data-test=card-provider-select]")).toBeNull();

    typeLabel(el, "Waiter phone");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    // The till seeds to the first (t1); no station, no hardware bindings.
    expect(api.createDeviceCode).toHaveBeenCalledWith({
      kind: "handheld",
      tillId: "t1",
      label: "Waiter phone",
    });
    expect(q(el, "[data-test=code-panel]")).toBeTruthy();
    expect(text(el, "[data-test=code-value]")).toBe("ABCD2345");
    expect(api.listDevices).toHaveBeenCalledTimes(2);
  });

  // A handheld needs no station, so an empty station set does NOT block a handheld generate — it binds to
  // a till, not a station. The station guard applies only to the kds_station kind.
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

    expect(api.createDeviceCode).toHaveBeenCalledWith({
      kind: "handheld",
      tillId: "t1",
      label: "Waiter phone",
    });
  });

  // The kind picker offers the till kind (SP-A.2 unified the counter till into the device model).
  it("offers the till kind in the kind picker", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    const option = q(el, "[data-test=kind-select] option[value=till]");
    expect(option).toBeTruthy();
    expect(option!.textContent?.trim()).toBe(t("devices.kind_till", "es-ES"));
  });

  // The kds_station kind shows the station picker and NEITHER the till NOR the hardware pickers — its
  // payload is unchanged (station + label only).
  it("shows the station picker and no till/hardware pickers for a kds_station", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=station-select]")).toBeTruthy();
    expect(q(el, "[data-test=till-select]")).toBeNull();
    expect(q(el, "[data-test=receipt-printer-select]")).toBeNull();
    expect(q(el, "[data-test=cash-drawer-switch]")).toBeNull();
    expect(q(el, "[data-test=card-provider-select]")).toBeNull();
  });

  // The till kind shows the till picker AND the hardware pickers (receipt printer, cash-drawer switch,
  // card-provider select), and hides the station picker.
  it("shows the till and hardware pickers for a till kind", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickKind(el, "till");
    await el.updateComplete;

    expect(q(el, "[data-test=station-select]")).toBeNull();
    expect(q(el, "[data-test=till-select]")).toBeTruthy();
    expect(q(el, "[data-test=receipt-printer-select]")).toBeTruthy();
    expect(q(el, "[data-test=cash-drawer-switch]")).toBeTruthy();
    expect(q(el, "[data-test=card-provider-select]")).toBeTruthy();
    // The card-reader-id field appears only once the provider is a Stripe Terminal reader.
    expect(q(el, "[data-test=card-reader-id]")).toBeNull();
  });

  // The assigned-profile picker is shown for EVERY kind (it is a device-wide binding, not till-only).
  it("shows the assigned-profile picker for every kind", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=profile-select]")).toBeTruthy(); // kds_station
    pickKind(el, "handheld");
    await el.updateComplete;
    expect(q(el, "[data-test=profile-select]")).toBeTruthy();
    pickKind(el, "till");
    await el.updateComplete;
    expect(q(el, "[data-test=profile-select]")).toBeTruthy();
  });

  // A till with every optional binding set: the payload carries tillId + the assigned profile + all the
  // hardware bindings, with the card reader id present because the provider is a Stripe Terminal reader.
  it("generates a till code with the tillId and every optional binding", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickKind(el, "till");
    await el.updateComplete;
    pickSelect(el, "till-select", "t2");
    pickSelect(el, "profile-select", "p1");
    pickSelect(el, "receipt-printer-select", "pr1");
    toggleCashDrawer(el, true);
    pickSelect(el, "card-provider-select", "stripe_terminal");
    await el.updateComplete;
    typeCardReader(el, "reader-123");
    typeLabel(el, "Caja principal");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect(api.createDeviceCode).toHaveBeenCalledWith({
      kind: "till",
      tillId: "t2",
      layoutProfileId: "p1",
      receiptPrinterId: "pr1",
      hasCashDrawer: true,
      cardProvider: "stripe_terminal",
      cardReaderId: "reader-123",
      label: "Caja principal",
    });
    expect(text(el, "[data-test=code-value]")).toBe("ABCD2345");
  });

  // A till with only the required till picked: the optional bindings default (profile none, no printer,
  // no cash drawer, card provider 'none'), so they are NOT sent — the payload is tillId + label only.
  it("generates a till code with only the tillId when no optional binding is set", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickKind(el, "till");
    await el.updateComplete;
    typeLabel(el, "Caja mínima");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    // The till seeds to the first (t1); no station, no hardware bindings sent.
    expect(api.createDeviceCode).toHaveBeenCalledWith({
      kind: "till",
      tillId: "t1",
      label: "Caja mínima",
    });
  });

  // The card-reader-id field shows ONLY for the stripe_terminal provider; a card provider that needs no
  // separate reader id (stripe_on_device) sends no cardReaderId even if one was typed then hidden.
  it("shows the card-reader field only for the stripe_terminal provider", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickKind(el, "till");
    await el.updateComplete;
    pickSelect(el, "card-provider-select", "stripe_terminal");
    await el.updateComplete;
    expect(q(el, "[data-test=card-reader-id]")).toBeTruthy();

    pickSelect(el, "card-provider-select", "stripe_on_device");
    await el.updateComplete;
    expect(q(el, "[data-test=card-reader-id]")).toBeNull();

    typeLabel(el, "Caja TTP");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect(api.createDeviceCode).toHaveBeenCalledWith({
      kind: "till",
      tillId: "t1",
      cardProvider: "stripe_on_device",
      label: "Caja TTP",
    });
  });

  // The generate guard for sale-capable kinds: a till (or handheld) with no till to bind to is a no-op,
  // mirroring the kds_station no-station guard. Proven by deletion: drop the till guard and #generate
  // fires with no tillId, which the server rejects device.till_required.
  it("does not generate a till code when there are no tills to bind to", async () => {
    const api = stubApi({ listTills: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickKind(el, "till");
    await el.updateComplete;
    typeLabel(el, "Caja");
    await el.updateComplete;
    q(el, "[data-test=generate]")!.click();
    await flush(el);

    expect(api.createDeviceCode).not.toHaveBeenCalled();
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
