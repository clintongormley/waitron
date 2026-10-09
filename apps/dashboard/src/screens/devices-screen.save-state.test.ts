import { LitElement, html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import type {
  DashboardApi,
  DeviceProfile,
  DeviceRow,
  JoinRequestRow,
  Printer,
  ReaderRow,
  Station,
} from "../api/client.js";
import "./devices-screen.js";
import type { DevicesScreen } from "./devices-screen.js";

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

const station = (id: string, name: string, active = true): Station => ({
  id,
  name,
  displayOrder: 0,
  isDefault: false,
  active,
  showsRestOfOrder: false,
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
});
const stations = [station("s1", "Cocina"), station("s2", "Barra"), station("s-off", "Old", false)];

const printer = (id: string, name: string, extra: Partial<Printer> = {}): Printer => ({
  id,
  name,
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
  portable: false,
  holder: null,
  active: true,
  ...extra,
});
const printers = [
  printer("pr1", "Cocina"),
  printer("pr2", "Terraza"),
  // Switched off since the till chose it; the till may keep it.
  printer("pr3", "Barra", { active: false }),
  printer("pr4", "Cajón", { hasCashDrawer: true }),
];

const profile = (id: string, name: string, extra: Partial<DeviceProfile> = {}): DeviceProfile => ({
  id,
  name,
  canvasId: null,
  capabilities: [],
  formFactor: "till",
  inactivityTimeoutSeconds: null,
  receiptPrinterIds: [],
  paymentSlipPrinterIds: [],
  cashDrawerPrinterIds: [],
  receiptPrinterDefaultId: null,
  paymentSlipPrinterDefaultId: null,
  cashDrawerPrinterDefaultId: null,
  startingScreen: null,
  departmentId: null,
  allowedZoneIds: null,
  startingZoneId: null,
  admittedRoles: ["staff", "supervisor", "manager", "admin"],
  personExceptions: [],
  ...extra,
});
const tillLists = {
  receiptPrinterIds: ["pr3", "pr1", "pr2"],
  paymentSlipPrinterIds: ["pr2", "pr1"],
  cashDrawerPrinterIds: ["pr4"],
};
const profiles = [
  profile("pa", "Counter till", tillLists),
  profile("pc", "Bar till", tillLists),
  profile("pd", "Deli till", tillLists),
  profile("pk", "Pass screen", { formFactor: "kds", ...tillLists }),
  profile("pl", "Grill screen", { formFactor: "kds" }),
];

const readers: ReaderRow[] = [
  {
    id: "r1",
    provider: "acme",
    name: "Front counter",
    active: true,
    canEnable: true,
    deviceCount: 1,
    deviceNames: ["Front till"],
  },
  {
    id: "r2",
    provider: "acme",
    name: "Bar",
    active: true,
    canEnable: true,
    deviceCount: 0,
    deviceNames: [],
  },
];

const base: DeviceRow = {
  id: "t1",
  kind: "till",
  kitchenScreens: [],
  label: "Caja 1",
  active: true,
  lastSeenAt: null,
  enrolledAt: "2026-08-20T09:00:00.000Z",
  deviceProfileId: "pa",
  profileRetired: false,
  receiptPrinterId: "pr3",
  paymentSlipPrinterId: "pr2",
  cashDrawerPrinterId: "pr4",
  // A made-here station since switched off: the form shows only the live one.
  madeHereStationIds: ["s2", "s-off"],
  // The device's own profile is among its stored approvals, as the server keeps it.
  approvedProfileIds: ["pa", "pc"],
  equipment: [],
  batteryLevel: null,
  batteryCharging: null,
  batteryReportedAt: null,
};
// Every field the Edit dialog shows holds something, in the shapes the device list returns.
const till = base;
/** A kitchen display whose station screen lists a station since switched off, as the server
 * reads it. */
const onOffStation: DeviceRow = {
  ...base,
  id: "k1",
  kind: "kds_station",
  label: "Pantalla Cocina",
  deviceProfileId: "pk",
  kitchenScreens: [
    {
      kind: "station",
      available: true,
      everyStation: false,
      everyZone: true,
      profileEveryStation: false,
      stations: [
        { id: "s1", name: "Cocina", available: true, switchedOff: false },
        { id: "s-off", name: "Old", available: false, switchedOff: true },
      ],
      zones: null,
    },
  ],
  receiptPrinterId: "pr1",
  paymentSlipPrinterId: "pr2",
  cashDrawerPrinterId: "pr4",
  madeHereStationIds: [],
  approvedProfileIds: ["pk", "pl"],
};
/** A kitchen display whose screen its profile took away. */
const screenTaken: DeviceRow = {
  ...onOffStation,
  id: "k2",
  label: "Pantalla Pase",
  kitchenScreens: [
    {
      kind: "pass_monitor",
      available: false,
      everyStation: false,
      everyZone: false,
      profileEveryStation: false,
      stations: [],
      zones: null,
    },
  ],
};

/** A kitchen display holding a station switched off on its own page and one a narrowing took. */
const heldAndGone: DeviceRow = {
  ...onOffStation,
  id: "k3",
  label: "Pantalla Fría",
  kitchenScreens: [
    {
      kind: "station",
      available: true,
      everyStation: false,
      everyZone: true,
      profileEveryStation: false,
      stations: [
        { id: "s1", name: "Cocina", available: true, switchedOff: false },
        { id: "s-gone", name: "Deli", available: false, switchedOff: false },
        { id: "s-off", name: "Old", available: false, switchedOff: true },
      ],
      zones: null,
    },
  ],
};
const withHeldAndGone = () =>
  stubApi({
    listDevices: vi.fn().mockResolvedValue([till, onOffStation, screenTaken, heldAndGone]),
  });

const returning: JoinRequestRow = {
  id: "j1",
  kind: "device",
  label: "Barra 1",
  createdAt: "2026-09-08T10:02:00.000Z",
  pairingBy: null,
};

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue([till, onOffStation, screenTaken]),
    listStations: vi.fn().mockResolvedValue(stations),
    listZones: vi.fn().mockResolvedValue([]),
    listDeviceProfiles: vi.fn().mockResolvedValue(profiles),
    listProfileKitchenScreens: vi.fn().mockResolvedValue(
      ["pk", "pl"].map((profileId) => ({
        profileId,
        screens: {
          station: { stationIds: ["s1", "s2", "s-off"], zoneIds: null },
          pass: { stationIds: null, zoneIds: null },
        },
      })),
    ),
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
    checkDeviceJoinNumber: vi.fn().mockResolvedValue(undefined),
    joinRequests: vi.fn().mockResolvedValue([returning]),
    joinChallenge: vi.fn().mockResolvedValue({ choices: ["12", "47", "83"] }),
    denyJoinRequest: vi.fn().mockResolvedValue(undefined),
    acceptDeviceJoinRequest: vi
      .fn()
      .mockResolvedValue({ deviceId: "d9", name: "Barra 1", formFactor: "till" }),
    updateDevice: vi.fn().mockResolvedValue(undefined),
    listReaders: vi.fn().mockResolvedValue(readers),
    listReaderHolders: vi.fn().mockResolvedValue([]),
    getProfileReaders: vi
      .fn()
      .mockResolvedValue({ readerIds: ["r1", "r2"], defaultReaderId: null }),
    getDeviceReader: vi.fn().mockResolvedValue({ readerId: "r2" }),
    setDeviceReader: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Table cells and row menus live in shadow roots below the screen's own. */
function deepQuery<T extends HTMLElement>(root: ShadowRoot, selector: string): T | null {
  const found = root.querySelector<T>(selector);
  if (found) return found;
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    const nested = node.shadowRoot ? deepQuery<T>(node.shadowRoot, selector) : null;
    if (nested) return nested;
  }
  return null;
}
const q = <T extends HTMLElement = HTMLElement>(el: DevicesScreen, selector: string) =>
  deepQuery<T>(el.shadowRoot!, selector);
const action = (el: DevicesScreen, test: string) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test=${test}]`)!;

async function state(el: DevicesScreen, test: string) {
  await el.updateComplete;
  const button = action(el, test);
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.disabled,
    innerDisabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (el: DevicesScreen) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
};

/** A real pointer press on the inner button, once the opening dialog has stopped moving it; `force`
 * presses a disabled one too. */
async function press(el: DevicesScreen, test: string) {
  const button = action(el, test).shadowRoot!.querySelector("button")!;
  let before = "";
  for (;;) {
    await frame();
    const now = JSON.stringify(button.getBoundingClientRect());
    if (now === before) break;
    before = now;
  }
  await userEvent.click(page.elementLocator(button), { force: true });
  await el.updateComplete;
}

async function typeName(el: DevicesScreen, value: string) {
  const field = q<HTMLElementTagNameMap["wt-input"]>(el, "[data-test=edit-name]")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

async function choose(el: DevicesScreen, test: string, value: string) {
  await chooseOption(q(el, `[data-test=${test}]`)!, value);
  await el.updateComplete;
}

async function tick(el: DevicesScreen, selector: string) {
  await userEvent.click(page.elementLocator(q<HTMLInputElement>(el, selector)!));
  await el.updateComplete;
}

/** Nothing a press of an untouched Save could have shown: no field error and no bottom message. */
async function noComplaint(el: DevicesScreen) {
  for (const field of el.shadowRoot!.querySelectorAll<HTMLElement & { error?: string }>(
    "[data-test=edit-device-modal] wt-input, [data-test=edit-device-modal] wt-combobox",
  ))
    expect(field.error ?? "").toBe("");
  const actions = q<HTMLElementTagNameMap["wt-form-actions"]>(el, "[data-test=edit-actions]")!;
  expect((await formMessageOf(actions))?.textContent?.trim() ?? "").toBe("");
}

async function openEdit(id = "t1", api: DashboardApi = stubApi()) {
  const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api, panels: [] });
  await vi.waitFor(() => expect(q(el, `[data-test=edit-device-${id}]`)).not.toBeNull());
  q(el, `[data-test=edit-device-${id}]`)!.click();
  await vi.waitFor(() => expect(q(el, "[data-test=edit-save]")).not.toBeNull());
  // The reader arrives on its own read; Save covers it only once it is there.
  await vi.waitFor(() =>
    expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=edit-reader]")!.disabled).toBe(
      false,
    ),
  );
  await settle(el);
  return { el, api };
}

const value = (el: DevicesScreen, test: string) =>
  q<HTMLElement & { value: string }>(el, `[data-test=${test}]`)!.value;
const checked = (el: DevicesScreen, fieldset: string) =>
  [...q(el, `[data-test=${fieldset}]`)!.querySelectorAll<HTMLInputElement>("input")].map((box) => [
    box.value,
    box.checked,
  ]);

describe("the Edit dialog's Save", () => {
  it("opens on a till with every field filled and Save quiet, and a press sends nothing", async () => {
    const { el, api } = await openEdit();
    expect(value(el, "edit-name")).toBe("Caja 1");
    expect(value(el, "edit-profile")).toBe("pa");
    expect(value(el, "edit-receipt-printer")).toBe("pr3");
    expect(value(el, "edit-slip-printer")).toBe("pr2");
    expect(value(el, "edit-cash-drawer")).toBe("pr4");
    expect(checked(el, "edit-made-here")).toEqual([
      ["s1", false],
      ["s2", true],
    ]);
    expect(checked(el, "edit-approved-profiles")).toEqual([
      ["pc", true],
      ["pd", false],
    ]);
    expect(value(el, "edit-reader")).toBe("r2");
    expect(await state(el, "edit-save")).toEqual(quiet);
    await press(el, "edit-save");
    await settle(el);
    expect(api.updateDevice).not.toHaveBeenCalled();
    expect(api.setDeviceReader).not.toHaveBeenCalled();
    expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
    await noComplaint(el);
  });

  it.each([
    ["a switched-off station", "k1", "station", "[data-test=edit-screen-station-s-off]"],
    ["a screen its profile took", "k2", "", "[data-test=edit-gone]"],
  ])("opens quiet on a kitchen display holding %s", async (_, id, screen, listed) => {
    const { el, api } = await openEdit(id);
    expect(value(el, "edit-screen")).toBe(screen);
    expect(q(el, listed)).not.toBeNull();
    expect(value(el, "edit-receipt-printer")).toBe("pr1");
    expect(checked(el, "edit-approved-profiles")).toEqual([["pl", true]]);
    expect(await state(el, "edit-save")).toEqual(quiet);
    await press(el, "edit-save");
    await settle(el);
    expect(api.updateDevice).not.toHaveBeenCalled();
    await noComplaint(el);
  });

  it("a name edit wakes Save, and typing it back quiets it, spaces and all", async () => {
    const { el } = await openEdit();
    await typeName(el, "Caja 2");
    expect(await state(el, "edit-save")).toEqual(ready);
    await typeName(el, "Caja 1");
    expect(await state(el, "edit-save")).toEqual(quiet);
    await typeName(el, " Caja 1 ");
    expect(await state(el, "edit-save")).toEqual(quiet);
  });

  it.each([
    ["the receipt printer", "edit-receipt-printer", "pr1", "pr3"],
    ["the slip printer", "edit-slip-printer", "", "pr2"],
    ["the cash drawer", "edit-cash-drawer", "", "pr4"],
    ["the card reader", "edit-reader", "r1", "r2"],
  ])("%s wakes Save, and choosing it back quiets it", async (_, test, other, original) => {
    const { el } = await openEdit();
    await choose(el, test, other);
    expect(await state(el, "edit-save")).toEqual(ready);
    await choose(el, test, original);
    expect(await state(el, "edit-save")).toEqual(quiet);
  });

  it("a kitchen display's Screen wakes Save", async () => {
    const { el } = await openEdit("k2");
    await choose(el, "edit-screen", "station");
    expect(await state(el, "edit-save")).toEqual(ready);
  });

  it("a station switched on in a kitchen display's list wakes Save, and switching it off quiets it", async () => {
    const { el } = await openEdit("k1");
    await tick(el, "[data-test=edit-screen-station-s2]");
    expect(await state(el, "edit-save")).toEqual(ready);
    await tick(el, "[data-test=edit-screen-station-s2]");
    expect(await state(el, "edit-save")).toEqual(quiet);
  });

  it.each([
    ["a made-here station", '[data-test=edit-made-here] input[value="s1"]'],
    ["an approved profile", '[data-test=edit-approved-profiles] input[value="pc"]'],
  ])("ticking %s wakes Save, and unticking it quiets it", async (_, selector) => {
    const { el } = await openEdit();
    await tick(el, selector);
    expect(await state(el, "edit-save")).toEqual(ready);
    await tick(el, selector);
    expect(await state(el, "edit-save")).toEqual(quiet);
  });

  it("another profile wakes Save", async () => {
    const { el } = await openEdit();
    await choose(el, "edit-profile", "pc");
    expect(await state(el, "edit-save")).toEqual(ready);
  });

  it("a press that reaches an untouched Save's handler sends nothing and marks nothing", async () => {
    const { el, api } = await openEdit();
    // A host `.click()` reaches the listener even while the inner button is disabled.
    action(el, "edit-save").click();
    await settle(el);
    expect(api.updateDevice).not.toHaveBeenCalled();
    expect(api.setDeviceReader).not.toHaveBeenCalled();
    await noComplaint(el);
  });

  it("a press after one edit sends that edit and every other field as it was read", async () => {
    const { el, api } = await openEdit();
    await typeName(el, "Caja 2");
    await press(el, "edit-save");
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    // The drawer and approvals are left out while unchanged, so the server keeps them.
    expect(api.updateDevice).toHaveBeenCalledExactlyOnceWith("t1", {
      name: "Caja 2",
      profileId: "pa",
      receiptPrinterId: "pr3",
      paymentSlipPrinterId: "pr2",
      madeHereStationIds: ["s2"],
    });
    expect(api.setDeviceReader).not.toHaveBeenCalled();
  });

  it("a kitchen screen's held switched-off station is kept once another field changes: the choice is not sent, so the server keeps it", async () => {
    const { el, api } = await openEdit("k1");
    await typeName(el, "Pantalla 2");
    await press(el, "edit-save");
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.updateDevice).toHaveBeenCalledExactlyOnceWith("k1", {
      name: "Pantalla 2",
      profileId: "pk",
      receiptPrinterId: "pr1",
      paymentSlipPrinterId: "pr2",
    });
  });

  it("a rename of a device holding a switched-off station and a removal sends no kitchen screens, so the removal stays recorded", async () => {
    const { el, api } = await openEdit("k3", withHeldAndGone());
    expect(await state(el, "edit-save")).toEqual(quiet);
    const off = q<HTMLElement & { checked: boolean; disabled: boolean; label: string }>(
      el,
      "[data-test=edit-screen-station-s-off]",
    )!;
    expect([off.checked, off.disabled, off.label]).toEqual([
      true,
      true,
      `Old (${t("devices.station_disabled_mark")})`,
    ]);
    expect(
      [...el.shadowRoot!.querySelectorAll("[data-test=edit-gone-item]")].map((item) =>
        item.textContent!.trim(),
      ),
    ).toEqual([
      `${t("device_profiles.kitchen_screen.station")}: Deli (${t("devices.no_longer_available")})`,
    ]);
    await typeName(el, "Pantalla 3");
    await press(el, "edit-save");
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.updateDevice).toHaveBeenCalledExactlyOnceWith("k3", {
      name: "Pantalla 3",
      profileId: "pk",
      receiptPrinterId: "pr1",
      paymentSlipPrinterId: "pr2",
    });
  });

  it("a changed station choice sends the switched-off station with it, and not the one a narrowing took", async () => {
    const { el, api } = await openEdit("k3", withHeldAndGone());
    await tick(el, "[data-test=edit-screen-station-s2]");
    expect(await state(el, "edit-save")).toEqual(ready);
    await press(el, "edit-save");
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.updateDevice).toHaveBeenCalledExactlyOnceWith("k3", {
      name: "Pantalla Fría",
      profileId: "pk",
      kitchenScreens: [{ kind: "station", stationIds: ["s1", "s2", "s-off"], zoneIds: null }],
      receiptPrinterId: "pr1",
      paymentSlipPrinterId: "pr2",
    });
  });

  it("a reader change alone is saved", async () => {
    const { el, api } = await openEdit();
    await choose(el, "edit-reader", "r1");
    await press(el, "edit-save");
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.setDeviceReader).toHaveBeenCalledExactlyOnceWith("t1", "r1");
  });

  it("an edit made while the save is in flight keeps the dialog open, measured from what was sent", async () => {
    let finish!: () => void;
    const api = stubApi({
      updateDevice: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { el } = await openEdit("t1", api);
    await typeName(el, "Caja 2");
    await press(el, "edit-save");
    await vi.waitFor(() => expect(typeof finish).toBe("function"));
    // The field is locked while the save runs, so the edit arrives as the field reports one.
    q(el, "[data-test=edit-name]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Caja 3" }, bubbles: true }),
    );
    finish();
    await vi.waitFor(async () => expect(await state(el, "edit-save")).toEqual(ready));
    expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
    await typeName(el, "Caja 2");
    expect(await state(el, "edit-save")).toEqual(quiet);
  });

  it("a refused reader keeps the dialog open with Save ready, and choosing the stored reader back quiets it", async () => {
    const api = stubApi({
      setDeviceReader: vi.fn().mockRejectedValue({ code: "reader.not_found" }),
    });
    const { el } = await openEdit("t1", api);
    await typeName(el, "Caja 2");
    await choose(el, "edit-reader", "r1");
    await press(el, "edit-save");
    await vi.waitFor(() => expect(api.setDeviceReader).toHaveBeenCalledTimes(1));
    await settle(el);
    expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
    expect(await state(el, "edit-save")).toEqual(ready);
    await choose(el, "edit-reader", "r2");
    expect(await state(el, "edit-save")).toEqual(quiet);
  });

  it("a name emptied by an edit keeps Save drawn as a change but unpressable once tried", async () => {
    const { el, api } = await openEdit();
    await typeName(el, "");
    expect(await state(el, "edit-save")).toEqual(ready);
    await press(el, "edit-save");
    expect(await state(el, "edit-save")).toEqual(blocked);
    expect(api.updateDevice).not.toHaveBeenCalled();
  });
});

describe("the Pair dialog's Pair", () => {
  it("opens on the settings step savable: the device's own name is what Pair approves", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      qrFor: vi.fn().mockResolvedValue("data:image/png;base64,FAKE"),
    });
    await vi.waitFor(() => expect(q(el, "[data-test=open-add-device]")).not.toBeNull());
    q(el, "[data-test=open-add-device]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pair-j1]")).not.toBeNull());
    q(el, "[data-test=pair-j1]")!.click();
    await vi.waitFor(() => expect(q(el, '[data-choice="47"]')).not.toBeNull());
    q(el, '[data-choice="47"]')!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pair-submit]")).not.toBeNull());
    expect(value(el, "pair-name")).toBe("Barra 1");
    expect(await state(el, "pair-submit")).toEqual(ready);
  });
});

class SharedLeaveFixture extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot>${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("devices-save-state-leave-fixture", SharedLeaveFixture);

describe("under the dashboard's leave coordinator", () => {
  it("the Edit dialog opens quiet, wakes on an edit and on a reader change", async () => {
    const { el: app } = await mountWidget<SharedLeaveFixture>(
      "devices-save-state-leave-fixture",
      {},
    );
    const el = document.createElement("dashboard-devices-screen");
    el.api = stubApi();
    el.panels = [];
    app.append(el);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-t1]")).not.toBeNull());
    q(el, "[data-test=edit-device-t1]")!.click();
    await vi.waitFor(() =>
      expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=edit-reader]")?.disabled).toBe(
        false,
      ),
    );
    await settle(el);
    expect(await state(el, "edit-save")).toEqual(quiet);
    await typeName(el, "Caja 2");
    expect(await state(el, "edit-save")).toEqual(ready);
    await typeName(el, "Caja 1");
    expect(await state(el, "edit-save")).toEqual(quiet);
    await choose(el, "edit-reader", "r1");
    expect(await state(el, "edit-save")).toEqual(ready);
  });
});
