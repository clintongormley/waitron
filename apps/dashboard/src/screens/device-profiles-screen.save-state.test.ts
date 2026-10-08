import { LitElement, html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type {
  DashboardApi,
  DeviceProfile,
  PersonSummary,
  Printer,
  ProfileReaderList,
  ProfileScopeChoices,
  ReaderRow,
  Station,
  Watcher,
} from "../api/client.js";
import "./device-profiles-screen.js";
import type { DeviceProfilesScreen } from "./device-profiles-screen.js";

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

const printer = (id: string, name: string, extra: Partial<Printer> = {}): Printer => ({
  id,
  name,
  transport: "network_tcp",
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
  pendingJobs: 0,
  lastPrintAt: null,
  lastPrintAgentId: null,
  active: true,
  ...extra,
});
const printers = [
  printer("pr1", "Barra"),
  printer("pr2", "Cocina"),
  printer("pr3", "Terraza"),
  printer("pr4", "Cajón", { hasCashDrawer: true }),
  // Switched off since the slip list took it; the list keeps it.
  printer("pr-old", "Vieja", { active: false }),
];

const readers: ReaderRow[] = [
  {
    id: "r1",
    provider: "acme",
    name: "Barra",
    active: true,
    canEnable: true,
    deviceCount: 0,
    deviceNames: [],
  },
  {
    id: "r2",
    provider: "acme",
    name: "Terraza",
    active: true,
    canEnable: true,
    deviceCount: 0,
    deviceNames: [],
  },
  {
    id: "r-off",
    provider: "acme",
    name: "Vieja",
    active: false,
    canEnable: true,
    deviceCount: 0,
    deviceNames: [],
  },
];
const storedReaders: ProfileReaderList = { readerIds: ["r-off", "r1"], defaultReaderId: "r1" };

const station = (id: string, name: string, active = true): Station => ({
  id,
  name,
  active,
  displayOrder: 0,
  isDefault: false,
  showsRestOfOrder: false,
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
});
const watcher = (id: string, name: string): Watcher => ({
  id,
  name,
  active: true,
  displayOrder: 0,
  everyStation: true,
  stationIds: [],
  everyZone: true,
  zoneIds: [],
  runsPass: true,
  printerIds: [],
});

const person = (personId: string, displayName: string, role: PersonSummary["role"]) =>
  ({
    personId,
    displayName,
    role,
    status: "active",
    hasPassword: true,
    hasTotp: false,
    email: null,
  }) satisfies PersonSummary;

const scopeChoices: ProfileScopeChoices = {
  departments: [
    { id: "d1", name: "Restaurante", active: true },
    { id: "d2", name: "Bar", active: true },
  ],
  zones: [
    { id: "z1", name: "Comedor", departmentId: "d1", active: true },
    { id: "z2", name: "Terraza", departmentId: "d1", active: true },
    { id: "z4", name: "Barra vieja", departmentId: "d1", active: false },
    { id: "z5", name: "Barra", departmentId: "d2", active: true },
  ],
};

// Every field the editor shows holds something, in the shapes the server returns.
const till: DeviceProfile = {
  id: "p1",
  name: "Front counter",
  canvasId: "c1",
  // Not in the form's order.
  capabilities: ["take-orders", "show-station", "integrated-card-payment"],
  formFactor: "till",
  // A minute and a half: the form shows a fraction.
  inactivityTimeoutSeconds: 90,
  receiptPrinterIds: ["pr2", "pr1"],
  paymentSlipPrinterIds: ["pr-old", "pr1"],
  cashDrawerPrinterIds: ["pr4"],
  receiptPrinterDefaultId: "pr1",
  paymentSlipPrinterDefaultId: "pr-old",
  cashDrawerPrinterDefaultId: "pr4",
  startingScreen: "show-station",
  departmentId: "d1",
  // z4 is switched off since, and was the starting zone: the form shows z2 alone, starting there.
  allowedZoneIds: ["z4", "z2"],
  startingZoneId: "z4",
  admittedRoles: ["manager", "staff"],
  personExceptions: [
    { personId: "pe-luis", admitted: false },
    { personId: "pe-ana", admitted: true },
  ],
};
const kds: DeviceProfile = {
  ...till,
  id: "p2",
  name: "Kitchen",
  canvasId: null,
  capabilities: ["show-station", "prepare-orders"],
  formFactor: "kds",
  inactivityTimeoutSeconds: null,
  receiptPrinterIds: ["pr1"],
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
};

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listDeviceProfiles: vi.fn().mockResolvedValue([till, kds]),
    getDeviceProfile: vi.fn(async (id: string) => (id === "p2" ? kds : till)),
    createDeviceProfile: vi.fn().mockResolvedValue({ ...till, id: "p9" }),
    updateDeviceProfile: vi.fn().mockResolvedValue(till),
    deleteDeviceProfile: vi.fn().mockResolvedValue(undefined),
    listCanvases: vi.fn().mockResolvedValue([
      { id: "c1", name: "Counter till", definition: {} },
      { id: "c2", name: "Kitchen board", definition: {} },
    ]),
    listPrinters: vi.fn().mockResolvedValue(printers),
    listStations: vi
      .fn()
      .mockResolvedValue([
        station("s1", "Cocina"),
        station("s2", "Plancha"),
        station("s-off", "Horno", false),
      ]),
    listWatchers: vi.fn().mockResolvedValue([watcher("w1", "Pase"), watcher("w2", "Barra")]),
    listProfileKitchenLists: vi
      .fn()
      .mockResolvedValue([{ profileId: "p2", stationIds: ["s-off", "s1"], watcherIds: ["w1"] }]),
    getProfileScopeChoices: vi.fn().mockResolvedValue(scopeChoices),
    listStaff: vi
      .fn()
      .mockResolvedValue([person("pe-ana", "Ana", "staff"), person("pe-luis", "Luis", "manager")]),
    listReaders: vi.fn().mockResolvedValue(readers),
    getProfileReaders: vi.fn(async (id: string) =>
      id === "p1" ? storedReaders : { readerIds: [], defaultReaderId: null },
    ),
    setProfileReaders: vi.fn(async (_id: string, list: ProfileReaderList) => list),
    ...overrides,
  } as unknown as DashboardApi;
}

const q = <T extends HTMLElement = HTMLElement>(el: DeviceProfilesScreen, test: string) =>
  el.shadowRoot!.querySelector<T>(`[data-test=${test}]`);
const save = (el: DeviceProfilesScreen) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, "profile-save")!;

async function settle(el: DeviceProfilesScreen) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function state(el: DeviceProfilesScreen) {
  await el.updateComplete;
  const button = save(el);
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

/** A real pointer press on Save's inner button once it has stopped moving; `force` presses a
 * disabled one too. */
async function press(el: DeviceProfilesScreen) {
  const button = save(el).shadowRoot!.querySelector("button")!;
  let before = "";
  for (;;) {
    await frame();
    const now = JSON.stringify(button.getBoundingClientRect());
    if (now === before) break;
    before = now;
  }
  await userEvent.click(page.elementLocator(button), { force: true });
  await settle(el);
}

async function typeName(el: DeviceProfilesScreen, value: string) {
  const field = q<HTMLElementTagNameMap["wt-input"]>(el, "profile-name")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

async function change(el: DeviceProfilesScreen, test: string, value: string | boolean) {
  q(el, test)!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: typeof value === "boolean" ? { checked: value } : { value },
    }),
  );
  await el.updateComplete;
}

async function click(el: DeviceProfilesScreen, test: string) {
  q(el, test)!.click();
  await el.updateComplete;
}

/** Nothing a press of an untouched Save could have shown: no field error and no bottom message. */
function noComplaint(el: DeviceProfilesScreen) {
  for (const field of el.shadowRoot!.querySelectorAll<HTMLElement & { error?: string }>(
    "wt-input, wt-combobox",
  ))
    expect(field.error ?? "").toBe("");
  expect(el.shadowRoot!.querySelector(".field-error")).toBeNull();
  expect(el.shadowRoot!.querySelector(".form-message")?.textContent?.trim() ?? "").toBe("");
}

async function openEdit(id = "p1", api: DashboardApi = stubApi()) {
  const { el } = await mountWidget<DeviceProfilesScreen>("dashboard-device-profiles-screen", {
    api,
  });
  await vi.waitFor(() => expect(q(el, `edit-${id}`)).not.toBeNull());
  q(el, `edit-${id}`)!.click();
  await vi.waitFor(() => expect(q(el, "profile-save")).not.toBeNull());
  // The readers arrive on their own read; Save covers them once they are there.
  if (id === "p1") await vi.waitFor(() => expect(q(el, "profile-reader-r1")).not.toBeNull());
  await settle(el);
  return { el, api };
}

async function openCreate(api: DashboardApi = stubApi()) {
  const { el } = await mountWidget<DeviceProfilesScreen>("dashboard-device-profiles-screen", {
    api,
  });
  await vi.waitFor(() => expect(q(el, "create")).not.toBeNull());
  q(el, "create")!.click();
  await vi.waitFor(() => expect(q(el, "profile-save")).not.toBeNull());
  await vi.waitFor(() => expect(api.getProfileScopeChoices).toHaveBeenCalled());
  await settle(el);
  return { el, api };
}

const checked = (el: DeviceProfilesScreen, test: string) =>
  q<HTMLElement & { checked: boolean }>(el, test)!.checked;
const value = (el: DeviceProfilesScreen, test: string) =>
  q<HTMLElement & { value: string }>(el, test)!.value;

/** The till profile as the update sends it when only its name changed: nothing beside it. */
const tillSent = (name: string) => [
  "p1",
  name,
  "c1",
  ["integrated-card-payment", "show-station", "take-orders"],
  "till",
  90,
  { receiptPrinterIds: ["pr2", "pr1"], paymentSlipPrinterIds: ["pr-old", "pr1"] },
];

describe("the device profile editor's Save", () => {
  it("opens a till profile with every field filled and Save quiet, and a press sends nothing", async () => {
    const { el, api } = await openEdit();
    expect(value(el, "profile-name")).toBe("Front counter");
    expect(value(el, "profile-canvas")).toBe("c1");
    expect(value(el, "profile-form-factor")).toBe("till");
    expect(value(el, "profile-inactivity")).toBe("1.5");
    expect(value(el, "profile-department")).toBe("d1");
    expect(checked(el, "profile-every-zone")).toBe(false);
    expect(checked(el, "profile-zone-z2")).toBe(true);
    expect(checked(el, "profile-zone-z1")).toBe(false);
    expect(value(el, "profile-starting-zone")).toBe("z2");
    expect(checked(el, "profile-role-manager")).toBe(true);
    expect(checked(el, "profile-role-supervisor")).toBe(false);
    expect(value(el, "profile-person-pe-ana")).toBe("allow");
    expect(value(el, "profile-person-pe-luis")).toBe("deny");
    expect(checked(el, "cap-show-station")).toBe(true);
    expect(value(el, "profile-starting-screen")).toBe("show-station");
    expect(checked(el, "payment-slip-printers-pr-old")).toBe(true);
    expect(value(el, "receipt-printers-default")).toBe("pr1");
    expect(value(el, "payment-slip-printers-default")).toBe("pr-old");
    expect(value(el, "cash-drawer-printers-default")).toBe("pr4");
    expect(checked(el, "profile-reader-r-off")).toBe(true);
    expect(value(el, "profile-readers-default")).toBe("r1");
    expect(await state(el)).toEqual(quiet);
    await press(el);
    expect(api.updateDeviceProfile).not.toHaveBeenCalled();
    expect(api.setProfileReaders).not.toHaveBeenCalled();
    expect(q(el, "editor-form")).not.toBeNull();
    noComplaint(el);
  });

  it.each(["en", "es"] as const)(
    "shows a profile's missing active zone on open in %s and holds Save until repaired",
    async (locale) => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const profile = { ...till, allowedZoneIds: ["z4"], startingZoneId: "z4" };
        const { el, api } = await openEdit(
          "p1",
          stubApi({
            getDeviceProfile: vi.fn().mockResolvedValue(profile),
          }),
        );
        const zoneError = () => q(el, "profile-zones-error")?.textContent?.trim();
        const bottom = () => el.shadowRoot!.querySelector(".form-message")?.textContent?.trim();
        expect(zoneError()).toBe(t("device_profiles.err_zones_required"));
        expect(bottom()).toBe(t("form.fix_fields"));
        expect(await state(el)).toEqual(quiet);
        await press(el);
        expect(api.updateDeviceProfile).not.toHaveBeenCalled();
        await change(el, "profile-reader-r2", true);
        expect(await state(el)).toEqual(blocked);
        q(el, "profile-save")!.click();
        await settle(el);
        expect(api.setProfileReaders).not.toHaveBeenCalled();
        await change(el, "profile-reader-r2", false);
        expect(await state(el)).toEqual(quiet);
        expect(zoneError()).toBe(t("device_profiles.err_zones_required"));
        await typeName(el, "Front counter 2");
        expect(await state(el)).toEqual(blocked);
        q(el, "profile-save")!.click();
        await settle(el);
        expect(api.updateDeviceProfile).not.toHaveBeenCalled();
        await change(el, "profile-zone-z1", true);
        expect(zoneError()).toBeUndefined();
        expect(bottom() ?? "").toBe("");
        expect(value(el, "profile-starting-zone")).toBe("z1");
        expect(await state(el)).toEqual(ready);
        await press(el);
        expect(api.updateDeviceProfile).toHaveBeenCalledWith(...tillSent("Front counter 2"), {
          departmentId: "d1",
          allowedZoneIds: ["z1"],
          startingZoneId: "z1",
        });
        await vi.waitFor(() => expect(q(el, "editor-form")).toBeNull());
      } finally {
        setLocale(previous);
      }
    },
  );

  it("marks zones when an every-zone profile's department has no active zone left", async () => {
    const { el } = await openEdit(
      "p1",
      stubApi({
        getDeviceProfile: vi.fn().mockResolvedValue({
          ...till,
          allowedZoneIds: null,
          startingZoneId: "z1",
        }),
        getProfileScopeChoices: vi.fn().mockResolvedValue({
          ...scopeChoices,
          zones: scopeChoices.zones.map((zone) =>
            zone.departmentId === "d1" ? { ...zone, active: false } : zone,
          ),
        }),
      }),
    );
    expect(q(el, "profile-zones-error")?.textContent?.trim()).toBe(
      t("device_profiles.err_zones_required"),
    );
    expect(await state(el)).toEqual(quiet);
    await change(el, "profile-department", "d2");
    expect(q(el, "profile-zones-error")).toBeNull();
    expect(value(el, "profile-starting-zone")).toBe("z5");
    expect(await state(el)).toEqual(ready);
  });

  it.each(["en", "es"] as const)(
    "keeps a profile with an active zone quiet and unmarked in %s",
    async (locale) => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const { el } = await openEdit();
        expect(await state(el)).toEqual(quiet);
        noComplaint(el);
      } finally {
        setLocale(previous);
      }
    },
  );

  it("opens a kitchen profile holding a switched-off station quiet, and a press sends nothing", async () => {
    const { el, api } = await openEdit("p2");
    expect(checked(el, "profile-station-s-off")).toBe(true);
    expect(checked(el, "profile-watcher-w1")).toBe(true);
    expect(await state(el)).toEqual(quiet);
    await press(el);
    expect(api.updateDeviceProfile).not.toHaveBeenCalled();
    expect(q(el, "editor-form")).not.toBeNull();
    noComplaint(el);
  });

  it("opens a new profile quiet once the venue's only department is filled in, and an untouched press marks no field", async () => {
    const api = stubApi({
      getProfileScopeChoices: vi.fn().mockResolvedValue({
        departments: [scopeChoices.departments[0]!],
        zones: scopeChoices.zones.filter((zone) => zone.departmentId === "d1"),
      }),
    });
    const { el } = await openCreate(api);
    expect(value(el, "profile-department")).toBe("d1");
    expect(value(el, "profile-starting-zone")).toBe("z1");
    expect(await state(el)).toEqual(quiet);
    await press(el);
    expect(api.createDeviceProfile).not.toHaveBeenCalled();
    noComplaint(el);
    await typeName(el, "Waiter");
    expect(await state(el)).toEqual(ready);
    await press(el);
    expect(api.createDeviceProfile).toHaveBeenCalledWith(
      "Waiter",
      null,
      [],
      "till",
      null,
      { receiptPrinterIds: [], paymentSlipPrinterIds: [] },
      { departmentId: "d1", allowedZoneIds: null, startingZoneId: "z1" },
    );
  });

  it("opens a new profile quiet where the venue has several departments", async () => {
    const { el, api } = await openCreate();
    expect(value(el, "profile-department")).toBe("");
    expect(await state(el)).toEqual(quiet);
    await press(el);
    expect(api.createDeviceProfile).not.toHaveBeenCalled();
    noComplaint(el);
  });

  it("wakes on a name edit and goes quiet when the name is typed back, spaces around it too", async () => {
    const { el } = await openEdit();
    await typeName(el, "Front counter 2");
    expect(await state(el)).toEqual(ready);
    await typeName(el, "Front counter");
    expect(await state(el)).toEqual(quiet);
    await typeName(el, " Front counter ");
    expect(await state(el)).toEqual(quiet);
  });

  const tillEdits: [
    string,
    (el: DeviceProfilesScreen) => Promise<void>,
    (el: DeviceProfilesScreen) => Promise<void>,
  ][] = [
    [
      "the canvas",
      (el) => change(el, "profile-canvas", "c2"),
      (el) => change(el, "profile-canvas", "c1"),
    ],
    [
      "the form factor",
      (el) => change(el, "profile-form-factor", "phone-portrait"),
      (el) => change(el, "profile-form-factor", "till"),
    ],
    [
      "the inactivity minutes",
      (el) => change(el, "profile-inactivity", "2"),
      (el) => change(el, "profile-inactivity", "1,5"),
    ],
    [
      "an action",
      (el) => change(el, "cap-take-cash", true),
      (el) => change(el, "cap-take-cash", false),
    ],
    [
      "a screen",
      (el) => change(el, "cap-show-expo", true),
      (el) => change(el, "cap-show-expo", false),
    ],
    [
      "the starting screen",
      (el) => change(el, "profile-starting-screen", ""),
      (el) => change(el, "profile-starting-screen", "show-station"),
    ],
    [
      "a zone",
      (el) => change(el, "profile-zone-z1", true),
      (el) => change(el, "profile-zone-z1", false),
    ],
    [
      "a role",
      (el) => change(el, "profile-role-supervisor", true),
      (el) => change(el, "profile-role-supervisor", false),
    ],
    [
      "a person's rule",
      (el) => change(el, "profile-person-pe-ana", ""),
      (el) => change(el, "profile-person-pe-ana", "allow"),
    ],
    [
      "a receipt printer",
      (el) => change(el, "receipt-printers-pr3", true),
      (el) => change(el, "receipt-printers-pr3", false),
    ],
    [
      "the receipt printers' order",
      (el) => click(el, "receipt-printers-down-pr2"),
      (el) => click(el, "receipt-printers-up-pr2"),
    ],
    [
      "the receipt default",
      (el) => change(el, "receipt-printers-default", "pr2"),
      (el) => change(el, "receipt-printers-default", "pr1"),
    ],
    [
      "a slip printer",
      (el) => change(el, "payment-slip-printers-pr1", false),
      (el) => change(el, "payment-slip-printers-pr1", true),
    ],
    [
      "the drawer list",
      (el) => change(el, "cash-drawer-printers-pr4", false),
      async (el) => {
        await change(el, "cash-drawer-printers-pr4", true);
        await change(el, "cash-drawer-printers-default", "pr4");
      },
    ],
    [
      "a card reader",
      (el) => change(el, "profile-reader-r2", true),
      (el) => change(el, "profile-reader-r2", false),
    ],
    [
      "the default reader",
      (el) => change(el, "profile-readers-default", "r-off"),
      (el) => change(el, "profile-readers-default", "r1"),
    ],
  ];
  it.each(tillEdits)(
    "wakes on %s and goes quiet when it is put back",
    async (_name, edit, undo) => {
      const { el } = await openEdit();
      await edit(el);
      expect(await state(el)).toEqual(ready);
      await undo(el);
      expect(await state(el)).toEqual(quiet);
    },
  );

  it("wakes on another department", async () => {
    const { el } = await openEdit();
    await change(el, "profile-department", "d2");
    expect(await state(el)).toEqual(ready);
  });

  it.each([
    ["a station", "profile-station-s2"],
    ["a watcher", "profile-watcher-w2"],
  ])(
    "on a kitchen profile, wakes on %s and goes quiet when it is unticked",
    async (_name, test) => {
      const { el } = await openEdit("p2");
      await change(el, test, true);
      expect(await state(el)).toEqual(ready);
      await change(el, test, false);
      expect(await state(el)).toEqual(quiet);
    },
  );

  it("sends nothing and marks nothing when an untouched Save's host is clicked", async () => {
    const { el, api } = await openEdit();
    save(el).click();
    await settle(el);
    expect(api.updateDeviceProfile).not.toHaveBeenCalled();
    expect(api.setProfileReaders).not.toHaveBeenCalled();
    noComplaint(el);
  });

  it("after one name edit, sends the edit with every other part as it was read, and closes", async () => {
    const { el, api } = await openEdit();
    await typeName(el, "Front counter 2");
    await press(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls).toEqual([tillSent("Front counter 2")]);
    expect(api.setProfileReaders).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(q(el, "editor-form")).toBeNull());
  });

  it("saves a change to the card readers alone through setProfileReaders", async () => {
    const { el, api } = await openEdit();
    await change(el, "profile-reader-r2", true);
    await press(el);
    await vi.waitFor(() => expect(q(el, "editor-form")).toBeNull());
    expect(vi.mocked(api.updateDeviceProfile).mock.calls).toEqual([tillSent("Front counter")]);
    expect(api.setProfileReaders).toHaveBeenCalledWith("p1", {
      readerIds: ["r-off", "r1", "r2"],
      defaultReaderId: "r1",
    });
  });

  it("keeps the editor open with Save ready on an edit made while the save is in flight, and the sent value typed back quiets it", async () => {
    let answer!: (profile: DeviceProfile) => void;
    const api = stubApi({
      updateDeviceProfile: vi.fn(
        () =>
          new Promise<DeviceProfile>((resolve) => {
            answer = resolve;
          }),
      ),
    });
    const { el } = await openEdit("p1", api);
    await typeName(el, "Front counter 2");
    await press(el);
    await change(el, "profile-role-supervisor", true);
    answer({ ...till, name: "Front counter 2" });
    await settle(el);
    expect(q(el, "editor-form")).not.toBeNull();
    expect(await state(el)).toEqual(ready);
    await change(el, "profile-role-supervisor", false);
    expect(await state(el)).toEqual(quiet);
  });

  it("keeps the editor open with Save ready when the reader save is refused, and putting the readers back quiets it", async () => {
    const api = stubApi({
      setProfileReaders: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await openEdit("p1", api);
    await typeName(el, "Front counter 2");
    await change(el, "profile-reader-r2", true);
    await press(el);
    await vi.waitFor(() => expect(api.setProfileReaders).toHaveBeenCalled());
    await settle(el);
    expect(q(el, "editor-form")).not.toBeNull();
    expect(await state(el)).toEqual(ready);
    // The profile part was saved: only the readers are still unsaved.
    await change(el, "profile-reader-r2", false);
    expect(await state(el)).toEqual(quiet);
  });

  it("is ready on an emptied name, and once pressed is primary and disabled with nothing sent", async () => {
    const { el, api } = await openEdit();
    await typeName(el, "");
    expect(await state(el)).toEqual(ready);
    await press(el);
    expect(await state(el)).toEqual(blocked);
    expect(q<HTMLElement & { error: string }>(el, "profile-name")!.error).toBe(
      t("form.name_required"),
    );
    expect(api.updateDeviceProfile).not.toHaveBeenCalled();
  });
});

class LeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-device-profiles-screen
        .api=${this.api}
      ></dashboard-device-profiles-screen>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("device-profiles-save-state-leave-app", LeaveApp);

describe("the device profile editor's Save under the leave coordinator", () => {
  it("opens quiet, wakes on a name edit, quiets when it is typed back, and wakes on a reader change", async () => {
    const { el: app } = await mountWidget<LeaveApp>("device-profiles-save-state-leave-app", {
      api: stubApi(),
    });
    const el = app.shadowRoot!.querySelector("dashboard-device-profiles-screen")!;
    await vi.waitFor(() => expect(q(el, "edit-p1")).not.toBeNull());
    q(el, "edit-p1")!.click();
    await vi.waitFor(() => expect(q(el, "profile-reader-r1")).not.toBeNull());
    await settle(el);
    expect(await state(el)).toEqual(quiet);
    await typeName(el, "Front counter 2");
    expect(await state(el)).toEqual(ready);
    await typeName(el, "Front counter");
    expect(await state(el)).toEqual(quiet);
    await change(el, "profile-reader-r2", true);
    expect(await state(el)).toEqual(ready);
  });
});
