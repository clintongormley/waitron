import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./device-profiles-screen.js";
import type { DeviceProfilesScreen } from "./device-profiles-screen.js";
import type {
  Canvas,
  DeviceProfile,
  DashboardApi,
  PersonRole,
  PersonSummary,
  Printer,
  ProfileReaderList,
  ProfileScopeChoices,
  Station,
  Watcher,
} from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(cleanupWidgets);

const canvases: Canvas[] = [
  { id: "c1", name: "Counter till", definition: {} },
  { id: "c2", name: "Kitchen board", definition: {} },
];

const EVERY_ROLE: PersonRole[] = ["staff", "supervisor", "manager", "admin"];

/** Where and for whom a profile with nothing narrowed serves: every zone, every role. */
const OPEN_ACCESS = {
  allowedZoneIds: null,
  admittedRoles: EVERY_ROLE,
  personExceptions: [],
  startingScreen: null,
};

const profiles: DeviceProfile[] = [
  {
    id: "p1",
    name: "Front counter",
    canvasId: "c1",
    capabilities: ["integrated-card-payment", "open-cash-drawer"],
    formFactor: "till",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
    cashDrawerPrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
    ...OPEN_ACCESS,
    departmentId: "d1",
    startingZoneId: "z1",
  },
  {
    id: "p2",
    name: "Kitchen",
    canvasId: null,
    capabilities: [],
    formFactor: "kds",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
    cashDrawerPrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
    ...OPEN_ACCESS,
    departmentId: null,
    startingZoneId: null,
  },
];

const NO_PRINTERS = { receiptPrinterIds: [], paymentSlipPrinterIds: [] };

/** The venue's one department and its zones, a switched-off one among them. */
const scopeChoices: ProfileScopeChoices = {
  departments: [{ id: "d1", name: "Restaurante", active: true }],
  zones: [
    { id: "z1", name: "Comedor", departmentId: "d1", active: true },
    { id: "z2", name: "Terraza", departmentId: "d1", active: true },
    { id: "z4", name: "Barra vieja", departmentId: "d1", active: false },
  ],
};

/** What a new ordering profile sends when the venue has one department: it, at its first zone. */
const ORDERING = { departmentId: "d1", allowedZoneIds: null, startingZoneId: "z1" };

function person(
  personId: string,
  displayName: string,
  role: PersonRole,
  status: PersonSummary["status"] = "active",
): PersonSummary {
  return { personId, displayName, role, status, hasPassword: true, hasTotp: false, email: null };
}

const staff = [
  person("pe-ana", "Ana", "staff"),
  person("pe-luis", "Luis", "manager"),
  person("pe-marta", "Marta", "supervisor", "suspended"),
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listDeviceProfiles: vi.fn().mockResolvedValue(profiles),
    getDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    createDeviceProfile: vi.fn().mockResolvedValue({ ...profiles[0], id: "p9" }),
    updateDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    deleteDeviceProfile: vi.fn().mockResolvedValue(undefined),
    listCanvases: vi.fn().mockResolvedValue(canvases),
    listPrinters: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    listWatchers: vi.fn().mockResolvedValue([]),
    listProfileKitchenLists: vi.fn().mockResolvedValue([]),
    getProfileScopeChoices: vi.fn().mockResolvedValue(scopeChoices),
    listStaff: vi.fn().mockResolvedValue(staff),
    listReaders: vi.fn().mockResolvedValue([]),
    getProfileReaders: vi.fn().mockResolvedValue({ readerIds: [], defaultReaderId: null }),
    setProfileReaders: vi.fn().mockResolvedValue({ readerIds: [], defaultReaderId: null }),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: DeviceProfilesScreen) {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

async function mount(api = stubApi()) {
  const { el } = await mountWidget<DeviceProfilesScreen>("dashboard-device-profiles-screen", {
    api,
  });
  await flush(el);
  return el;
}

function change(el: DeviceProfilesScreen, testId: string, value: string) {
  el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function toggle(el: DeviceProfilesScreen, testId: string, checked: boolean) {
  el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
}

/** One edit, so Save has a change to send. */
function rename(el: DeviceProfilesScreen, name = "Renamed") {
  change(el, "profile-name", name);
}

async function expectSaveQuiet(el: DeviceProfilesScreen) {
  await el.updateComplete;
  const button = el.shadowRoot!.querySelector<HTMLElement & { variant: string; disabled: boolean }>(
    "[data-test=profile-save]",
  )!;
  expect([button.variant, button.disabled]).toEqual(["secondary", true]);
}

function selectCanvas(el: DeviceProfilesScreen, value: string) {
  void chooseOption(el.shadowRoot!.querySelector("[data-test=profile-canvas]")!, value);
}

function selectFormFactor(el: DeviceProfilesScreen, value: string) {
  void chooseOption(el.shadowRoot!.querySelector("[data-test=profile-form-factor]")!, value);
}

describe("device-profiles-screen list mode", () => {
  it("loads and lists device profiles with their referenced canvas name and capability summary", async () => {
    const api = stubApi();
    const el = await mount(api);
    expect(api.listDeviceProfiles).toHaveBeenCalledTimes(1);
    expect(api.listCanvases).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector("[data-test=profile-name-p1]")!.textContent).toContain(
      "Front counter",
    );
    // The canvas reference resolves to the canvas NAME, not its id.
    expect(el.shadowRoot!.querySelector("[data-test=profile-canvas-p1]")!.textContent).toContain(
      "Counter till",
    );
    // Two capabilities are summarised on the row (shipped locale is es-ES).
    const caps = el.shadowRoot!.querySelector("[data-test=profile-caps-p1]")!.textContent!;
    expect(caps).toContain("tarjeta");
    // A null canvas reference and empty capabilities render their neutral fallbacks, not a throw.
    expect(el.shadowRoot!.querySelector("[data-test=profile-row-p2]")).toBeTruthy();
  });

  it("shows a placeholder when there are no profiles", async () => {
    const el = await mount(stubApi({ listDeviceProfiles: vi.fn().mockResolvedValue([]) }));
    expect(el.shadowRoot!.querySelector("[data-test=no-profiles]")).toBeTruthy();
  });

  it("shows the load error in a banner", async () => {
    const el = await mount(
      stubApi({ listDeviceProfiles: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
    );
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  });

  it("clears a failed refresh's message once the server answers again", async () => {
    const api = Object.assign(stubApi(), { liveData: new LiveData() });
    const el = await mount(api);
    const alert = () => el.shadowRoot!.querySelector("[role=alert]");
    vi.mocked(api.listDeviceProfiles).mockRejectedValue({ code: "connection.failed" });
    api.liveData.refresh();
    await vi.waitFor(() =>
      expect(alert()?.textContent?.trim()).toBe(codeMessage("connection.failed")),
    );
    vi.mocked(api.listDeviceProfiles).mockResolvedValue([
      ...profiles,
      { ...profiles[1]!, id: "p3", name: "Bar screen" },
    ]);
    api.liveData.refresh();
    await vi.waitFor(() => expect(alert()).toBeNull());
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=profile-row-p3]")).toBeTruthy();
  });

  it("Delete confirms then calls deleteDeviceProfile and reloads", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-p1]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await flush(el);
    expect(api.deleteDeviceProfile).toHaveBeenCalledWith("p1");
    expect(api.listDeviceProfiles).toHaveBeenCalledTimes(2);
  });

  it("shows a mutation error in a banner when a delete fails", async () => {
    const api = stubApi({
      deleteDeviceProfile: vi.fn().mockRejectedValue({ code: "device_profile.not_found" }),
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-p1]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  });

  it("Duplicate creates a copy from the same canvas + capabilities under a '(copy)' name", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=duplicate-p1]")!.click();
    await flush(el);
    // The shipped locale is es-ES, so the copy suffix is the Spanish " (copia)". The copy carries the
    // source profile's form factor unchanged.
    expect(api.createDeviceProfile).toHaveBeenCalledWith(
      "Front counter (copia)",
      "c1",
      ["integrated-card-payment", "open-cash-drawer"],
      "till",
      null,
      NO_PRINTERS,
      ORDERING,
    );
    expect(api.listDeviceProfiles).toHaveBeenCalledTimes(2);
  });
});

describe("device-profiles-screen editor form", () => {
  it("New profile opens a blank editor form (no id) and Save creates via createDeviceProfile", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("[data-test=editor-form]")!;
    expect(form).toBeTruthy();
    expect(form.getAttribute("data-editing-id")).toBeNull();
    change(el, "profile-name", "Kitchen tablet");
    await el.updateComplete;
    selectCanvas(el, "c2");
    await el.updateComplete;
    selectFormFactor(el, "tablet-landscape");
    await el.updateComplete;
    toggle(el, "cap-act-as-kds", true);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.createDeviceProfile).toHaveBeenCalledWith(
      "Kitchen tablet",
      "c2",
      ["act-as-kds"],
      "tablet-landscape",
      null,
      NO_PRINTERS,
      ORDERING,
    );
    // Back in list mode after a successful save.
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
  });

  it("lets a handheld profile enable receipt printing", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    change(el, "profile-name", "Waiter");
    selectFormFactor(el, "phone-portrait");
    await el.updateComplete;
    toggle(el, "cap-print-receipt", true);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.createDeviceProfile).toHaveBeenCalledWith(
      "Waiter",
      null,
      ["print-receipt"],
      "phone-portrait",
      null,
      NO_PRINTERS,
      ORDERING,
    );
  });

  it("draws a My schedule button switch whose save sends show-schedule", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    change(el, "profile-name", "Waiter");
    selectFormFactor(el, "phone-portrait");
    await el.updateComplete;
    const scheduleSwitch = el.shadowRoot!.querySelector("[data-test=cap-show-schedule]")!;
    // Shipped locale is es-ES.
    expect(scheduleSwitch.getAttribute("label")).toBe("Botón Mi horario");
    toggle(el, "cap-show-schedule", true);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.createDeviceProfile).toHaveBeenCalledWith(
      "Waiter",
      null,
      ["show-schedule"],
      "phone-portrait",
      null,
      NO_PRINTERS,
      ORDERING,
    );
  });

  it("draws a Takes cash switch whose save sends take-cash", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    change(el, "profile-name", "Waiter");
    selectFormFactor(el, "phone-portrait");
    await el.updateComplete;
    const cashSwitch = el.shadowRoot!.querySelector("[data-test=cap-take-cash]")!;
    // Shipped locale is es-ES.
    expect(cashSwitch.getAttribute("label")).toBe("Cobra en efectivo");
    toggle(el, "cap-take-cash", true);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.createDeviceProfile).toHaveBeenCalledWith(
      "Waiter",
      null,
      ["take-cash"],
      "phone-portrait",
      null,
      NO_PRINTERS,
      ORDERING,
    );
  });

  it("New profile defaults the form factor to the cash register (till) when unchanged", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    change(el, "profile-name", "Counter");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.createDeviceProfile).toHaveBeenCalledWith(
      "Counter",
      null,
      [],
      "till",
      null,
      NO_PRINTERS,
      ORDERING,
    );
  });

  it("the form-factor picker offers the four form factors with their human labels", async () => {
    const el = await mount(stubApi());
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    const options = (
      el.shadowRoot!.querySelector("[data-test=profile-form-factor]") as unknown as {
        options: { value: string; label: string }[];
      }
    ).options;
    expect(options.map((o) => o.value)).toEqual([
      "till",
      "phone-portrait",
      "tablet-landscape",
      "kds",
    ]);
    // The shipped locale is es-ES; the four values map to their localised labels (the "till" value is
    // the cash register — never the raw token).
    const labels = options.map((o) => o.label.trim());
    expect(labels).toEqual([
      "Caja registradora",
      "Teléfono de mano",
      "Tableta de mano",
      "Pantalla de cocina",
    ]);
  });

  it("Save refuses an empty name (banner shown, no write)", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    change(el, "profile-name", "   ");
    // A name of spaces alone is no change; another edit makes the form one Save can press.
    toggle(el, "cap-take-cash", true);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.createDeviceProfile).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  });

  it("Edit loads the profile via getDeviceProfile; the capability switches reflect its flags", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    expect(api.getDeviceProfile).toHaveBeenCalledWith("p1");
    const form = el.shadowRoot!.querySelector("[data-test=editor-form]")!;
    expect(form.getAttribute("data-editing-id")).toBe("p1");
    // The name + canvas + capability switches reflect the loaded profile.
    const name = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=profile-name]",
    )!;
    expect(name.value).toBe("Front counter");
    const cardSwitch = el.shadowRoot!.querySelector<HTMLElement & { checked: boolean }>(
      "[data-test=cap-integrated-card-payment]",
    )!;
    expect(cardSwitch.checked).toBe(true);
    const kdsSwitch = el.shadowRoot!.querySelector<HTMLElement & { checked: boolean }>(
      "[data-test=cap-act-as-kds]",
    )!;
    expect(kdsSwitch.checked).toBe(false);
    // The form-factor picker pre-selects the loaded profile's form factor (p1 is a till).
    const formFactor = el.shadowRoot!.querySelector<Combobox>("[data-test=profile-form-factor]")!;
    expect(formFactor.value).toBe("till");
  });

  it("Edit pre-selects a non-default form factor and Save sends it via updateDeviceProfile", async () => {
    const kdsProfile: DeviceProfile = { ...profiles[0], formFactor: "kds" };
    const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(kdsProfile) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    const formFactor = el.shadowRoot!.querySelector<Combobox>("[data-test=profile-form-factor]")!;
    expect(formFactor.value).toBe("kds");
    rename(el, "Kitchen counter");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Kitchen counter",
      "c1",
      [],
      "kds",
      null,
      NO_PRINTERS,
    );
  });

  it("Edit → toggling a capability off then Save calls updateDeviceProfile without it", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    toggle(el, "cap-integrated-card-payment", false);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Front counter",
      "c1",
      ["open-cash-drawer"],
      "till",
      null,
      NO_PRINTERS,
    );
  });

  it("Edit → clearing the canvas dropdown saves canvasId null (form-factor default)", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    selectCanvas(el, "");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Front counter",
      null,
      ["integrated-card-payment", "open-cash-drawer"],
      "till",
      null,
      NO_PRINTERS,
    );
  });

  it("a non-KDS draft renders the inactivity-timeout input; 5 minutes saves 300 seconds (trailing arg)", async () => {
    const phone: DeviceProfile = { ...profiles[0], formFactor: "phone-portrait" };
    const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(phone) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    // The input renders for a non-KDS form factor.
    expect(el.shadowRoot!.querySelector("[data-test=profile-inactivity]")).toBeTruthy();
    change(el, "profile-inactivity", "5");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    // Minutes are converted to seconds at the wire edge: 5 → 300, passed as the trailing arg.
    expect(api.updateDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Front counter",
      "c1",
      ["integrated-card-payment", "open-cash-drawer"],
      "phone-portrait",
      300,
      NO_PRINTERS,
    );
  });

  it("a KDS draft hides the inactivity-timeout input and saves a null timeout", async () => {
    const kdsProfile: DeviceProfile = { ...profiles[0], formFactor: "kds" };
    const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(kdsProfile) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    // No timeout input for a kitchen display.
    expect(el.shadowRoot!.querySelector("[data-test=profile-inactivity]")).toBeNull();
    rename(el, "Kitchen counter");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Kitchen counter",
      "c1",
      [],
      "kds",
      null,
      NO_PRINTERS,
    );
  });

  it("Edit seeds the inactivity-timeout input in minutes from the stored seconds (300 → 5)", async () => {
    const phone: DeviceProfile = {
      ...profiles[0],
      formFactor: "phone-portrait",
      inactivityTimeoutSeconds: 300,
    };
    const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(phone) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    const input = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=profile-inactivity]",
    )!;
    expect(input.value).toBe("5");
  });

  it("Edit shows the error banner and stays in list mode when getDeviceProfile fails", async () => {
    const api = stubApi({
      getDeviceProfile: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=profile-row-p1]")).toBeTruthy();
  });

  it("Cancel discards the form and returns to the list", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=profile-row-p1]")).toBeTruthy();
    expect(api.createDeviceProfile).not.toHaveBeenCalled();
  });

  it("shows a server rejection (name taken) in the editor banner without leaving the form", async () => {
    const api = stubApi({
      createDeviceProfile: vi.fn().mockRejectedValue({ code: "device_profile.name_taken" }),
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    change(el, "profile-name", "Front counter");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
    // Still in the editor form so the operator can correct the name.
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeTruthy();
  });
});

it.each(["create", "edit-p1"])(
  "gates Enter plus an immediate Save click during %s and permits retry",
  async (action) => {
    let reject!: (reason: unknown) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(profiles[0]);
    const el = await mount(stubApi({ createDeviceProfile: save, updateDeviceProfile: save }));
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
    await flush(el);
    change(el, "profile-name", "Retry profile");
    await el.updateComplete;
    const field = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
      "[data-test=profile-name]",
    )!;
    await field.updateComplete;
    field.shadowRoot!.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    expect(save).toHaveBeenCalledTimes(1);
    reject({ code: "device_profile.name_taken" });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=profile-save]")!.hasAttribute("disabled")).toBe(
      false,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(save).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
  },
);

it("refreshes displayed profiles when their data changes elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<HTMLElement & { api: DashboardApi }>(
    "dashboard-device-profiles-screen",
    { api },
  );
  const rows = (): unknown[] => (el as unknown as Record<string, unknown[]>)["profiles"]!;
  await vi.waitFor(() => expect(rows()?.length).toBeGreaterThan(0));
  vi.mocked(api.listDeviceProfiles).mockResolvedValue([]);
  liveData.invalidate([{ type: "device_profiles", id: "changed-elsewhere" }]);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(api.listDeviceProfiles).toHaveBeenCalledTimes(2);
});

describe("device-profiles-screen remaining edges", () => {
  it("labels a profile whose canvas is no longer in the set as an unknown canvas", async () => {
    const orphan: DeviceProfile = { ...profiles[0]!, id: "p3", canvasId: "c-gone" };
    const el = await mount(stubApi({ listDeviceProfiles: vi.fn().mockResolvedValue([orphan]) }));

    expect(el.shadowRoot!.querySelector("[data-test=profile-canvas-p3]")!.textContent).toBe(
      `${t("device_profiles.canvas_label")}: ${t("device_profiles.canvas_unknown")}`,
    );
  });

  it.each([
    ["blank", "  "],
    ["non-numeric", "soon"],
  ])("clears the inactivity timeout when the minutes field is %s", async (_label, value) => {
    const phone: DeviceProfile = {
      ...profiles[0]!,
      formFactor: "phone-portrait",
      inactivityTimeoutSeconds: 300,
    };
    const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(phone) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=profile-inactivity]")).not.toBeNull(),
    );

    change(el, "profile-inactivity", value);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();

    await vi.waitFor(() =>
      expect(api.updateDeviceProfile).toHaveBeenCalledWith(
        "p1",
        "Front counter",
        "c1",
        ["integrated-card-payment", "open-cash-drawer"],
        "phone-portrait",
        null,
        NO_PRINTERS,
      ),
    );
  });

  it("saves the profile when Enter is pressed in the inactivity field", async () => {
    const phone: DeviceProfile = { ...profiles[0]!, formFactor: "phone-portrait" };
    const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(phone) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=profile-inactivity]")).not.toBeNull(),
    );
    change(el, "profile-inactivity", "2");
    await el.updateComplete;
    const field = el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-inactivity]")!;
    await (field as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    field.shadowRoot!.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );

    await vi.waitFor(() =>
      expect(api.updateDeviceProfile).toHaveBeenCalledWith(
        "p1",
        "Front counter",
        "c1",
        ["integrated-card-payment", "open-cash-drawer"],
        "phone-portrait",
        120,
        NO_PRINTERS,
      ),
    );
  });

  it("deletes once when the confirm button is pressed twice", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-p1]")!.click();
    await el.updateComplete;
    const confirm = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!;

    confirm.click();
    confirm.click();

    await vi.waitFor(() => expect(api.listDeviceProfiles).toHaveBeenCalledTimes(2));
    expect(api.deleteDeviceProfile).toHaveBeenCalledTimes(1);
    expect(api.deleteDeviceProfile).toHaveBeenCalledWith("p1");
  });
});

type Combobox = HTMLElement & {
  options: { value: string; label: string }[];
  value: string;
  label: string;
  name: string;
  placeholder: string;
  search: string;
  disabled: boolean;
  error: string;
  updateComplete: Promise<boolean>;
};

describe("device-profiles-screen fields", () => {
  const box = (el: DeviceProfilesScreen, selector: string) =>
    el.shadowRoot!.querySelector(`wt-combobox${selector}`) as Combobox | null;

  it("picks the canvas and form factor from labelled dropdowns showing the profile's own", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);

    const canvas = box(el, "[data-test=profile-canvas]")!;
    expect(canvas.name).toBe("canvasId");
    expect(canvas.label).toBe(t("device_profiles.canvas_label"));
    expect(canvas.search).toBe("auto");
    expect(canvas.placeholder).toBe(t("device_profiles.canvas_default"));
    expect(canvas.options).toEqual([
      { value: "", label: t("device_profiles.canvas_default") },
      { value: "c1", label: "Counter till" },
      { value: "c2", label: "Kitchen board" },
    ]);
    expect(canvas.value).toBe("c1");

    const formFactor = box(el, "[data-test=profile-form-factor]")!;
    expect(formFactor.name).toBe("formFactor");
    expect(formFactor.label).toBe(t("device_profiles.form_factor"));
    expect(formFactor.search).toBe("auto");
    expect(formFactor.options.map((o) => o.value)).toEqual([
      "till",
      "phone-portrait",
      "tablet-landscape",
      "kds",
    ]);
    expect(formFactor.value).toBe("till");

    await chooseOption(canvas, "c2");
    await chooseOption(formFactor, "tablet-landscape");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Front counter",
      "c2",
      ["integrated-card-payment", "open-cash-drawer"],
      "tablet-landscape",
      null,
      NO_PRINTERS,
    );
  });

  it("draws no home page section and reads no layout choices", async () => {
    const api = stubApi();
    expect("getDeviceHomeLayouts" in api).toBe(false);
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=profile-save]")).not.toBeNull(),
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-test="home-layouts"]')).toBeNull();
  });
});

it.each(["connection.failed", "server.internal"])(
  "keeps a failed duplicate's message through a re-read failing with %s and the reads' recovery",
  async (rereadCode) => {
    const api = Object.assign(
      stubApi({ createDeviceProfile: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData: new LiveData() },
    );
    const el = await mount(api);
    const alert = () => el.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim();
    vi.mocked(api.listDeviceProfiles).mockRejectedValue({ code: "connection.failed" });
    api.liveData.refresh();
    await vi.waitFor(() => expect(alert()).toBe(codeMessage("connection.failed")));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=duplicate-p1]")!.click();
    await vi.waitFor(() => expect(api.createDeviceProfile).toHaveBeenCalledOnce());
    await flush(el);
    vi.mocked(api.listDeviceProfiles).mockRejectedValue({ code: rereadCode });
    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listDeviceProfiles).toHaveBeenCalledTimes(3));
    await flush(el);
    vi.mocked(api.listDeviceProfiles).mockResolvedValue([
      ...profiles,
      { ...profiles[1]!, id: "p3", name: "Bar screen" },
    ]);
    api.liveData.refresh();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=profile-row-p3]")).toBeTruthy(),
    );
    await flush(el);
    expect(alert()).toBe(codeMessage("connection.failed"));
  },
);

describe("device-profiles-screen printer lists", () => {
  function printer(id: string, name: string, active = true): Printer {
    return {
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
      active,
    };
  }

  const venuePrinters = [
    printer("pr1", "Barra"),
    printer("pr2", "Cocina"),
    printer("pr3", "Terraza"),
    printer("pr4", "Vieja", false),
  ];

  const listedProfile: DeviceProfile = {
    ...profiles[0]!,
    receiptPrinterIds: ["pr2", "pr1"],
    paymentSlipPrinterIds: ["pr3"],
  };

  async function editListed(overrides: Partial<DashboardApi> = {}) {
    const api = stubApi({
      listDeviceProfiles: vi.fn().mockResolvedValue([listedProfile, profiles[1]]),
      getDeviceProfile: vi.fn().mockResolvedValue(listedProfile),
      listPrinters: vi.fn().mockResolvedValue(venuePrinters),
      ...overrides,
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    return { api, el };
  }

  type Switch = HTMLElement & { checked: boolean; label: string };

  function switches(el: DeviceProfilesScreen, list: string): Switch[] {
    return [
      ...el.shadowRoot!.querySelectorAll<Switch>(`[data-test=${list}] wt-switch[data-printer-id]`),
    ];
  }

  function switchedOn(el: DeviceProfilesScreen, list: string): string[] {
    return switches(el, list)
      .filter((s) => s.checked)
      .map((s) => s.dataset.printerId!);
  }

  async function save(el: DeviceProfilesScreen) {
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
  }

  function savedLists(api: DashboardApi) {
    return vi.mocked(api.updateDeviceProfile).mock.calls[0]![6];
  }

  it("shows each list's printers switched on, in the profile's order", async () => {
    const { el } = await editListed();
    expect(switchedOn(el, "receipt-printers")).toEqual(["pr2", "pr1"]);
    expect(switchedOn(el, "payment-slip-printers")).toEqual(["pr3"]);
    // The printers a list does not hold are offered, switched off, after the ones it does.
    expect(switches(el, "receipt-printers").map((s) => s.dataset.printerId)).toEqual([
      "pr2",
      "pr1",
      "pr3",
    ]);
    expect(switches(el, "receipt-printers").map((s) => s.label)).toEqual([
      "Cocina",
      "Barra",
      "Terraza",
    ]);
  });

  it("adds a printer switched on to the end of its list, leaving the other list as it was", async () => {
    const { api, el } = await editListed();
    toggle(el, "receipt-printers-pr3", true);
    await el.updateComplete;
    expect(switchedOn(el, "receipt-printers")).toEqual(["pr2", "pr1", "pr3"]);
    await save(el);
    expect(savedLists(api)).toEqual({
      receiptPrinterIds: ["pr2", "pr1", "pr3"],
      paymentSlipPrinterIds: ["pr3"],
    });
  });

  it("moves a printer up its list", async () => {
    const { api, el } = await editListed();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=receipt-printers-up-pr1]")!.click();
    await el.updateComplete;
    expect(switchedOn(el, "receipt-printers")).toEqual(["pr1", "pr2"]);
    await save(el);
    expect(savedLists(api)).toEqual({
      receiptPrinterIds: ["pr1", "pr2"],
      paymentSlipPrinterIds: ["pr3"],
    });
  });

  it("moves a printer down its list, and drops one switched off", async () => {
    const { api, el } = await editListed();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=receipt-printers-down-pr2]")!.click();
    await el.updateComplete;
    toggle(el, "payment-slip-printers-pr3", false);
    await el.updateComplete;
    await save(el);
    expect(savedLists(api)).toEqual({
      receiptPrinterIds: ["pr1", "pr2"],
      paymentSlipPrinterIds: [],
    });
  });

  it("offers no move past either end, and none for a printer not on the list", async () => {
    const { el } = await editListed();
    const button = (test: string) =>
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`[data-test=${test}]`);
    expect(button("receipt-printers-up-pr2")!.disabled).toBe(true);
    expect(button("receipt-printers-down-pr2")!.disabled).toBe(false);
    expect(button("receipt-printers-up-pr1")!.disabled).toBe(false);
    expect(button("receipt-printers-down-pr1")!.disabled).toBe(true);
    expect(button("receipt-printers-up-pr3")).toBeNull();
    // Each button names the printer it moves.
    expect(button("receipt-printers-up-pr1")!.getAttribute("aria-label")).toBe(
      `${t("device_profiles.move_up")} Barra`,
    );
    expect(button("receipt-printers-down-pr2")!.getAttribute("aria-label")).toBe(
      `${t("device_profiles.move_down")} Cocina`,
    );
  });

  it("keeps a switched-off printer a list still holds, and offers none it does not", async () => {
    const withOld: DeviceProfile = { ...listedProfile, paymentSlipPrinterIds: ["pr4", "pr3"] };
    const { api, el } = await editListed({
      getDeviceProfile: vi.fn().mockResolvedValue(withOld),
    });
    const slip = switches(el, "payment-slip-printers");
    expect(slip.map((s) => s.dataset.printerId)).toEqual(["pr4", "pr3", "pr1", "pr2"]);
    expect(slip[0]!.label).toBe("Vieja (Deshabilitada)");
    expect(switches(el, "receipt-printers").map((s) => s.dataset.printerId)).not.toContain("pr4");
    await expectSaveQuiet(el);
    rename(el);
    await save(el);
    expect(savedLists(api)).toEqual({
      receiptPrinterIds: ["pr2", "pr1"],
      paymentSlipPrinterIds: ["pr4", "pr3"],
    });
  });

  it("keeps a listed printer the printer list has not delivered, without drawing it", async () => {
    const withUnknown: DeviceProfile = { ...listedProfile, receiptPrinterIds: ["pr-new", "pr2"] };
    const { api, el } = await editListed({
      getDeviceProfile: vi.fn().mockResolvedValue(withUnknown),
    });
    expect(switches(el, "receipt-printers").map((s) => s.dataset.printerId)).toEqual([
      "pr2",
      "pr1",
      "pr3",
    ]);
    await expectSaveQuiet(el);
    rename(el);
    await save(el);
    expect(savedLists(api)).toEqual({
      receiptPrinterIds: ["pr-new", "pr2"],
      paymentSlipPrinterIds: ["pr3"],
    });
  });

  it("ends the move buttons at the printers drawn, past an undelivered one", async () => {
    const button = (el: DeviceProfilesScreen, test: string) =>
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`[data-test=${test}]`)!;
    const trailing = await editListed({
      getDeviceProfile: vi.fn().mockResolvedValue({
        ...listedProfile,
        receiptPrinterIds: ["pr2", "pr1", "pr-new"],
      }),
    });
    expect(button(trailing.el, "receipt-printers-down-pr1").disabled).toBe(true);
    cleanupWidgets();
    const leading = await editListed({
      getDeviceProfile: vi.fn().mockResolvedValue({
        ...listedProfile,
        receiptPrinterIds: ["pr-new", "pr2", "pr1"],
      }),
    });
    expect(button(leading.el, "receipt-printers-up-pr2").disabled).toBe(true);
  });

  it("swaps a moved printer with the printer drawn next to it, past an undelivered one", async () => {
    const { api, el } = await editListed({
      getDeviceProfile: vi.fn().mockResolvedValue({
        ...listedProfile,
        receiptPrinterIds: ["pr2", "pr-new", "pr1"],
      }),
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=receipt-printers-up-pr1]")!.click();
    await el.updateComplete;
    expect(switchedOn(el, "receipt-printers")).toEqual(["pr1", "pr2"]);
    await save(el);
    expect(savedLists(api)).toEqual({
      receiptPrinterIds: ["pr1", "pr-new", "pr2"],
      paymentSlipPrinterIds: ["pr3"],
    });
  });

  it("says to add a printer first when the venue has none", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-printers]")!.textContent!.trim()).toBe(
      t("device_profiles.no_printers"),
    );
    expect(el.shadowRoot!.querySelector("[data-test=receipt-printers]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=payment-slip-printers]")).toBeNull();
  });

  it("creates a new profile with the lists chosen in its editor", async () => {
    const api = stubApi({ listPrinters: vi.fn().mockResolvedValue(venuePrinters) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    change(el, "profile-name", "Caja");
    toggle(el, "receipt-printers-pr2", true);
    toggle(el, "payment-slip-printers-pr1", true);
    await el.updateComplete;
    await save(el);
    expect(api.createDeviceProfile).toHaveBeenCalledWith(
      "Caja",
      null,
      [],
      "till",
      null,
      { receiptPrinterIds: ["pr2"], paymentSlipPrinterIds: ["pr1"] },
      ORDERING,
    );
  });

  it("copies a profile's printer lists when it is duplicated", async () => {
    const { api, el } = await editListed();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=duplicate-p1]")!.click();
    await flush(el);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![5]).toEqual({
      receiptPrinterIds: ["pr2", "pr1"],
      paymentSlipPrinterIds: ["pr3"],
    });
  });

  it("starts the next profile opened from its own lists, not the last one's", async () => {
    const { el } = await editListed();
    toggle(el, "receipt-printers-pr3", true);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    expect(switchedOn(el, "receipt-printers")).toEqual([]);
    expect(switchedOn(el, "payment-slip-printers")).toEqual([]);
  });
});

describe("device-profiles-screen station and watcher lists", () => {
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
  const watcher = (id: string, name: string): Watcher => ({
    id,
    name,
    everyStation: true,
    stationIds: [],
    everyZone: true,
    zoneIds: [],
    runsPass: false,
    displayOrder: 0,
    active: true,
    printerIds: [],
  });
  const kitchen = profiles[1]!;

  async function editKitchen(overrides: Partial<DashboardApi> = {}) {
    const api = stubApi({
      getDeviceProfile: vi.fn().mockResolvedValue(kitchen),
      listStations: vi
        .fn()
        .mockResolvedValue([
          station("s1", "Grill"),
          station("s2", "Cold"),
          station("s3", "Pastry"),
          station("s-off", "Old grill", false),
        ]),
      listWatchers: vi.fn().mockResolvedValue([watcher("w1", "Pass"), watcher("w2", "Bar pass")]),
      listProfileKitchenLists: vi
        .fn()
        .mockResolvedValue([{ profileId: "p2", stationIds: ["s1", "s-off"], watcherIds: ["w1"] }]),
      ...overrides,
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p2]")!.click();
    await flush(el);
    return { api, el };
  }

  type Switch = HTMLElement & { checked: boolean; label: string };
  const switchesIn = (el: DeviceProfilesScreen, group: string) => [
    ...el.shadowRoot!.querySelectorAll<Switch>(`[data-test=${group}] wt-switch`),
  ];
  const shown = (el: DeviceProfilesScreen, group: string) =>
    switchesIn(el, group).map((s) => [s.label, s.checked]);

  async function save(el: DeviceProfilesScreen) {
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
  }

  it("shows a kitchen display's listed stations and watchers switched on, and the others off", async () => {
    const { el } = await editKitchen();
    expect(shown(el, "profile-stations")).toEqual([
      ["Grill", true],
      [`Old grill (${t("devices.station_disabled_mark")})`, true],
      ["Cold", false],
      ["Pastry", false],
    ]);
    expect(shown(el, "profile-watchers")).toEqual([
      ["Pass", true],
      ["Bar pass", false],
    ]);
  });

  it("draws no station or watcher list for a profile that is not a kitchen display", async () => {
    const el = await mount(
      stubApi({ listStations: vi.fn().mockResolvedValue([station("s1", "Grill")]) }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=profile-stations]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=profile-watchers]")).toBeNull();
  });

  it("saves the lists it changed, keeping a listed station switched off since", async () => {
    const { api, el } = await editKitchen();
    toggle(el, "profile-station-s2", true);
    toggle(el, "profile-watcher-w1", false);
    await el.updateComplete;
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![7]).toEqual({
      stationIds: ["s1", "s-off", "s2"],
      watcherIds: [],
    });
  });

  it("opened before the lists' first read arrives, still saves from the profile's stored lists", async () => {
    const stored = [{ profileId: "p2", stationIds: ["s1", "s-off"], watcherIds: ["w1"] }];
    const { api, el } = await editKitchen({
      listProfileKitchenLists: vi
        .fn()
        .mockReturnValueOnce(new Promise(() => {}))
        .mockResolvedValue(stored),
    });
    toggle(el, "profile-station-s2", true);
    await el.updateComplete;
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![7]).toEqual({
      stationIds: ["s1", "s-off", "s2"],
      watcherIds: ["w1"],
    });
  });

  it("sends no lists when they are unchanged", async () => {
    const { api, el } = await editKitchen();
    await expectSaveQuiet(el);
    rename(el);
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]).toHaveLength(7);
  });

  it("creates a kitchen display with the stations and watchers chosen", async () => {
    const api = stubApi({
      listStations: vi.fn().mockResolvedValue([station("s1", "Grill")]),
      listWatchers: vi.fn().mockResolvedValue([watcher("w1", "Pass")]),
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    change(el, "profile-name", "Kitchen 2");
    selectFormFactor(el, "kds");
    await flush(el);
    toggle(el, "profile-station-s1", true);
    toggle(el, "profile-watcher-w1", true);
    await el.updateComplete;
    await save(el);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![6]).toEqual({
      stationIds: ["s1"],
      watcherIds: ["w1"],
    });
  });

  it("copies a kitchen display's switched-on stations and watchers when it is duplicated", async () => {
    const { api, el } = await editKitchen();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=duplicate-p2]")!.click();
    await flush(el);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![6]).toEqual({
      stationIds: ["s1"],
      watcherIds: ["w1"],
    });
  });

  it("names the screen that still shows a station the save took off, under the stations, and keeps the draft", async () => {
    const { el } = await editKitchen({
      updateDeviceProfile: vi.fn().mockRejectedValue({
        code: "device_profile.station_in_use",
        params: { stationId: "s1", deviceId: "d1", deviceName: "Grill screen" },
      }),
    });
    toggle(el, "profile-station-s1", false);
    await el.updateComplete;
    await save(el);
    expect(
      el.shadowRoot!.querySelector("[data-test=profile-stations-error]")?.textContent?.trim(),
    ).toBe(t("device_profiles.station_in_use").replace("{device}", "Grill screen"));
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim()).toBe(
      t("form.fix_fields"),
    );
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeTruthy();
    expect(shown(el, "profile-stations")).toContainEqual(["Grill", false]);

    toggle(el, "profile-station-s1", true);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=profile-stations-error]")).toBeNull();
  });

  it("names the screen that still shows a watcher the save took off, under the watchers", async () => {
    const { el } = await editKitchen({
      updateDeviceProfile: vi.fn().mockRejectedValue({
        code: "device_profile.watcher_in_use",
        params: { watcherId: "w1", deviceId: "d2", deviceName: "Pass screen" },
      }),
    });
    toggle(el, "profile-watcher-w1", false);
    await el.updateComplete;
    await save(el);
    expect(
      el.shadowRoot!.querySelector("[data-test=profile-watchers-error]")?.textContent?.trim(),
    ).toBe(t("device_profiles.watcher_in_use").replace("{device}", "Pass screen"));
  });
});

describe("device-profiles-screen where a profile serves and who signs in (W97)", () => {
  type Field = HTMLElement & { value: string; error: string; required: boolean; checked: boolean };
  const q = (el: DeviceProfilesScreen, testId: string) =>
    el.shadowRoot!.querySelector<Field>(`[data-test="${testId}"]`);
  const text = (el: DeviceProfilesScreen, testId: string) =>
    q(el, testId)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
  const bottom = (el: DeviceProfilesScreen) =>
    el.shadowRoot!.querySelector(".form-message")?.textContent?.trim() ?? null;
  const saveButton = (el: DeviceProfilesScreen) => q(el, "profile-save")!;
  const options = (el: DeviceProfilesScreen, testId: string) =>
    (q(el, testId) as unknown as Combobox).options.map((o) => o.value);

  async function save(el: DeviceProfilesScreen) {
    saveButton(el).click();
    await flush(el);
  }

  async function openCreate(api = stubApi()) {
    const el = await mount(api);
    q(el, "create")!.click();
    await flush(el);
    change(el, "profile-name", "Terraza");
    await el.updateComplete;
    return el;
  }

  async function openEdit(profile: DeviceProfile, overrides: Partial<DashboardApi> = {}) {
    const api = stubApi({
      listDeviceProfiles: vi.fn().mockResolvedValue([profile, profiles[1]]),
      getDeviceProfile: vi.fn().mockResolvedValue(profile),
      ...overrides,
    });
    const el = await mount(api);
    q(el, `edit-${profile.id}`)!.click();
    await flush(el);
    return { api, el };
  }

  const extras = (api: DashboardApi) => vi.mocked(api.updateDeviceProfile).mock.calls[0]![7];

  it("keeps a stored zone switched off since when a save changes only the name", async () => {
    const { api, el } = await openEdit({
      ...profiles[0]!,
      allowedZoneIds: ["z1", "z4"],
      startingZoneId: "z1",
    });
    change(el, "profile-name", "Renamed counter");
    await save(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledOnce();
    expect(extras(api)).toBeUndefined();
  });

  it("holds a name and role change until a profile with no active zone has its scope repaired", async () => {
    const { api, el } = await openEdit({
      ...profiles[0]!,
      allowedZoneIds: ["z4"],
      startingZoneId: "z4",
    });
    change(el, "profile-name", "Renamed counter");
    toggle(el, "profile-role-staff", false);
    await save(el);
    expect(api.updateDeviceProfile).not.toHaveBeenCalled();
    expect(text(el, "profile-zones-error")).toBe(t("device_profiles.err_zones_required"));
    expect(q(el, "editor-form")).not.toBeNull();
    toggle(el, "profile-zone-z1", true);
    await flush(el);
    await save(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledOnce();
    expect(extras(api)).toEqual({
      admittedRoles: ["supervisor", "manager", "admin"],
      departmentId: "d1",
      allowedZoneIds: ["z1"],
      startingZoneId: "z1",
    });
    expect(q(el, "editor-form")).toBeNull();
  });

  it("asks for zones once the manager edits where a profile with no zone left serves", async () => {
    const { api, el } = await openEdit({
      ...profiles[0]!,
      allowedZoneIds: ["z4"],
      startingZoneId: "z4",
    });
    toggle(el, "profile-zone-z1", true);
    await flush(el);
    toggle(el, "profile-zone-z1", false);
    await flush(el);
    // Toggling the zone back leaves the draft as opened; the name edit gives Save a change.
    rename(el);
    await save(el);
    expect(api.updateDeviceProfile).not.toHaveBeenCalled();
    expect(text(el, "profile-zones-error")).toBe(t("device_profiles.err_zones_required"));
  });

  it("keeps a reopened new profile's departments when the first opening's read arrives late", async () => {
    let arriveLate!: (choices: ProfileScopeChoices) => void;
    const api = stubApi({
      getProfileScopeChoices: vi
        .fn()
        .mockImplementationOnce(
          () => new Promise<ProfileScopeChoices>((resolve) => (arriveLate = resolve)),
        )
        .mockResolvedValueOnce({
          departments: [{ id: "d2", name: "Deli", active: true }],
          zones: [{ id: "dz2", name: "Deli counter", departmentId: "d2", active: true }],
        }),
    });
    const el = await mount(api);
    q(el, "create")!.click();
    await flush(el);
    q(el, "profile-cancel")!.click();
    await flush(el);
    q(el, "create")!.click();
    await flush(el);
    arriveLate(scopeChoices);
    await flush(el);
    expect(q(el, "profile-department")!.value).toBe("d2");
    expect(options(el, "profile-department")).toEqual(["d2"]);
    expect(options(el, "profile-starting-zone")).toEqual(["dz2"]);
  });

  it("stays on a new profile opened while an edit's reads were still on their way", async () => {
    let arriveLate!: (profile: DeviceProfile) => void;
    const api = stubApi({
      getDeviceProfile: vi.fn(
        () => new Promise<DeviceProfile>((resolve) => (arriveLate = resolve)),
      ),
    });
    const el = await mount(api);
    q(el, "edit-p1")!.click();
    await flush(el);
    q(el, "create")!.click();
    await flush(el);
    change(el, "profile-name", "Terraza");
    await flush(el);
    arriveLate(profiles[0]!);
    await flush(el);
    expect(q(el, "editor-form")!.hasAttribute("data-editing-id")).toBe(false);
    expect(q(el, "profile-name")!.value).toBe("Terraza");
  });

  it("starts a new profile in the venue's only department, at its first zone, using every zone", async () => {
    const api = stubApi();
    const el = await openCreate(api);
    expect(q(el, "profile-department")!.value).toBe("d1");
    expect(q(el, "profile-department")!.required).toBe(true);
    expect(q(el, "profile-every-zone")!.checked).toBe(true);
    expect(text(el, "profile-zones-hint")).toBe(
      t("device_profiles.every_zone_hint").replace("{department}", "Restaurante"),
    );
    expect(q(el, "profile-starting-zone")!.value).toBe("z1");
    expect(q(el, "profile-starting-zone")!.required).toBe(true);
    expect(options(el, "profile-starting-zone")).toEqual(["z1", "z2"]);
    await save(el);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![6]).toEqual(ORDERING);
  });

  it("asks for a department when the venue has several, beside the field and at the bottom, and sends nothing until one is chosen", async () => {
    const api = stubApi({
      getProfileScopeChoices: vi.fn().mockResolvedValue({
        departments: [...scopeChoices.departments, { id: "d2", name: "Deli", active: true }],
        zones: [
          ...scopeChoices.zones,
          { id: "z3", name: "Mostrador", departmentId: "d2", active: true },
        ],
      }),
    });
    const el = await openCreate(api);
    expect(q(el, "profile-department")!.value).toBe("");
    await save(el);
    expect(api.createDeviceProfile).not.toHaveBeenCalled();
    expect(q(el, "profile-department")!.error).toBe(t("device_profiles.err_department_required"));
    expect(bottom(el)).toBe(t("form.fix_fields"));
    expect(saveButton(el).hasAttribute("disabled")).toBe(true);
    await chooseOption(q(el, "profile-department")!, "d2");
    await flush(el);
    expect(q(el, "profile-department")!.error).toBe("");
    expect(q(el, "profile-starting-zone")!.value).toBe("z3");
    expect(bottom(el)).toBeNull();
    expect(saveButton(el).hasAttribute("disabled")).toBe(false);
    await save(el);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![6]).toEqual({
      departmentId: "d2",
      allowedZoneIds: null,
      startingZoneId: "z3",
    });
  });

  it("offers some zones from the department's switched-on ones, and the starting zone only among those", async () => {
    const { api, el } = await openEdit(profiles[0]!);
    expect(q(el, "profile-zones")).toBeNull();
    toggle(el, "profile-every-zone", false);
    await flush(el);
    const zoneSwitches = [...q(el, "profile-zones")!.querySelectorAll<Field>("wt-switch")];
    expect(zoneSwitches.map((s) => s.dataset.test)).toEqual(["profile-zone-z1", "profile-zone-z2"]);
    expect(zoneSwitches.every((s) => s.checked)).toBe(true);
    toggle(el, "profile-zone-z1", false);
    await flush(el);
    expect(options(el, "profile-starting-zone")).toEqual(["z2"]);
    expect(q(el, "profile-starting-zone")!.value).toBe("z2");
    await save(el);
    expect(extras(api)).toEqual({
      departmentId: "d1",
      allowedZoneIds: ["z2"],
      startingZoneId: "z2",
    });
  });

  it("refuses some zones with none chosen, beside the zones", async () => {
    const { api, el } = await openEdit(profiles[0]!);
    toggle(el, "profile-every-zone", false);
    await flush(el);
    toggle(el, "profile-zone-z1", false);
    toggle(el, "profile-zone-z2", false);
    await flush(el);
    await save(el);
    expect(api.updateDeviceProfile).not.toHaveBeenCalled();
    expect(text(el, "profile-zones-error")).toBe(t("device_profiles.err_zones_required"));
    expect(q(el, "profile-starting-zone")!.error).toBe(
      t("device_profiles.err_starting_zone_required"),
    );
    expect(bottom(el)).toBe(t("form.fix_fields"));
  });

  it("lists who can sign in, following the roles and each person's own rule", async () => {
    const { api, el } = await openEdit(profiles[0]!);
    expect(text(el, "admitted-people")).toBe(
      t("device_profiles.admitted_people").replace("{names}", "Ana, Luis"),
    );
    toggle(el, "profile-role-staff", false);
    await flush(el);
    expect(text(el, "admitted-people")).toBe(
      t("device_profiles.admitted_people").replace("{names}", "Luis"),
    );
    await chooseOption(q(el, "profile-person-pe-ana")!, "allow");
    await chooseOption(q(el, "profile-person-pe-luis")!, "deny");
    await flush(el);
    expect(text(el, "admitted-people")).toBe(
      t("device_profiles.admitted_people").replace("{names}", "Ana"),
    );
    expect(q(el, "profile-person-pe-marta")).toBeNull();
    await save(el);
    expect(extras(api)).toEqual({
      admittedRoles: ["supervisor", "manager", "admin"],
      personExceptions: [
        { personId: "pe-ana", admitted: true },
        { personId: "pe-luis", admitted: false },
      ],
    });
  });

  it("says so when nobody can sign in", async () => {
    const { el } = await openEdit(profiles[0]!);
    await chooseOption(q(el, "profile-person-pe-ana")!, "deny");
    await chooseOption(q(el, "profile-person-pe-luis")!, "deny");
    await flush(el);
    expect(text(el, "admitted-people")).toBe(t("device_profiles.admitted_nobody"));
  });

  it("refuses a profile no role can sign in on, beside the roles, sending nothing", async () => {
    const { api, el } = await openEdit(profiles[0]!);
    for (const role of EVERY_ROLE) toggle(el, `profile-role-${role}`, false);
    await flush(el);
    await save(el);
    expect(api.updateDeviceProfile).not.toHaveBeenCalled();
    expect(text(el, "profile-roles-error")).toBe(t("device_profiles.err_roles_required"));
    expect(bottom(el)).toBe(t("form.fix_fields"));
    toggle(el, "profile-role-manager", true);
    await flush(el);
    expect(q(el, "profile-roles-error")).toBeNull();
    expect(bottom(el)).toBeNull();
  });

  it("draws actions and screens as separate groups, and offers a kitchen display only Prepares orders", async () => {
    const { api, el } = await openEdit({
      ...profiles[0]!,
      capabilities: ["take-orders", "open-cash-drawer", "act-as-kds", "prepare-orders"],
    });
    const flags = (group: string) =>
      [...q(el, group)!.querySelectorAll<Field>("wt-switch")].map((s) => s.dataset.test);
    expect(flags("profile-actions")).toEqual([
      "cap-take-orders",
      "cap-take-cash",
      "cap-integrated-card-payment",
      "cap-hand-keyed-card-payment",
      "cap-prepare-orders",
      "cap-hand-over-orders",
      "cap-print-receipt",
      "cap-open-cash-drawer",
    ]);
    expect(flags("profile-screens")).toEqual([
      "cap-act-as-kds",
      "cap-show-station",
      "cap-show-expo",
      "cap-show-schedule",
    ]);
    expect(text(el, "actions-hint")).toBe(t("device_profiles.actions_hint"));
    selectFormFactor(el, "kds");
    await flush(el);
    expect(flags("profile-actions")).toEqual(["cap-prepare-orders"]);
    expect(text(el, "actions-hint")).toBe(t("device_profiles.shared_display_actions_hint"));
    expect(q(el, "profile-department")).toBeNull();
    expect(q(el, "profile-roles")).toBeNull();
    expect(q(el, "profile-starting-screen")).toBeNull();
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![3]).toEqual([
      "act-as-kds",
      "prepare-orders",
    ]);
  });

  it("starts on a ticked screen or the first tab, and clears a starting screen whose switch goes off", async () => {
    const { api, el } = await openEdit({
      ...profiles[0]!,
      capabilities: ["show-schedule", "show-station"],
      startingScreen: "show-schedule",
    });
    expect(q(el, "profile-starting-screen")!.value).toBe("show-schedule");
    expect(options(el, "profile-starting-screen")).toEqual(["", "show-station", "show-schedule"]);
    toggle(el, "cap-show-expo", true);
    await flush(el);
    expect(options(el, "profile-starting-screen")).toEqual([
      "",
      "show-station",
      "show-expo",
      "show-schedule",
    ]);
    toggle(el, "cap-show-schedule", false);
    await flush(el);
    expect(q(el, "profile-starting-screen")!.value).toBe("");
    await save(el);
    expect(extras(api)).toEqual({ startingScreen: null });
  });

  it("can clear a starting screen from its own field", async () => {
    const { api, el } = await openEdit({
      ...profiles[0]!,
      capabilities: ["show-schedule"],
      startingScreen: "show-schedule",
    });
    await chooseOption(q(el, "profile-starting-screen")!, "");
    await flush(el);
    await save(el);
    expect(extras(api)).toEqual({ startingScreen: null });
  });

  it("says a kitchen display's station and watcher lists are what each screen picks from on Devices", async () => {
    const grill: Station = {
      id: "s1",
      name: "Grill",
      displayOrder: 0,
      isDefault: false,
      active: true,
      showsRestOfOrder: false,
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
    };
    const { el } = await openEdit(profiles[1]!, {
      listStations: vi.fn().mockResolvedValue([grill]),
    });
    expect(text(el, "kitchen-lists-hint")).toBe(t("device_profiles.kitchen_lists_hint"));
  });

  it.each([
    [
      {
        code: "device_profile.access_invalid",
        params: { field: "departmentId", reason: "not_found" },
      },
      "department",
      "device_profiles.err_department",
    ],
    [
      {
        code: "device_profile.access_invalid",
        params: { field: "allowedZoneIds", reason: "outside_department" },
      },
      "zones",
      "device_profiles.err_zones",
    ],
    [
      {
        code: "device_profile.access_invalid",
        params: { field: "startingZoneId", reason: "unavailable" },
      },
      "starting-zone",
      "device_profiles.err_starting_zone",
    ],
    [
      {
        code: "device_profile.admission_invalid",
        params: { field: "admittedRoles", reason: "empty" },
      },
      "roles",
      "device_profiles.err_roles_required",
    ],
    [
      {
        code: "device_profile.admission_invalid",
        params: { field: "personExceptions", reason: "not_found", personId: "pe-gone" },
      },
      "people",
      "device_profiles.err_people",
    ],
    [
      { code: "device_profile.invalid", params: { reason: "shared_display_action" } },
      "actions",
      "device_profiles.err_shared_display_action",
    ],
    [
      { code: "device_profile.invalid", params: { reason: "bad_starting_screen" } },
      "starting-screen",
      "device_profiles.err_starting_screen",
    ],
  ] as const)(
    "keeps the draft and puts a refusal (%o) under its field",
    async (refusal, field, sentence) => {
      const { el } = await openEdit(profiles[0]!, {
        updateDeviceProfile: vi.fn().mockRejectedValue(refusal),
      });
      change(el, "profile-name", "Draft name");
      await el.updateComplete;
      await save(el);
      const target = q(el, `profile-${field}`);
      const shown =
        target?.tagName === "WT-COMBOBOX" ? target.error : text(el, `profile-${field}-error`);
      expect(shown).toBe(t(sentence));
      expect(bottom(el)).toBe(t("form.fix_fields"));
      expect(q(el, "editor-form")).not.toBeNull();
      expect(q(el, "profile-name")!.value).toBe("Draft name");
      expect(saveButton(el).hasAttribute("disabled")).toBe(false);
    },
  );

  it("drops a refusal from its field once that field changes", async () => {
    const { el } = await openEdit(profiles[0]!, {
      updateDeviceProfile: vi.fn().mockRejectedValue({
        code: "device_profile.access_invalid",
        params: { field: "startingZoneId", reason: "unavailable" },
      }),
    });
    rename(el);
    await save(el);
    expect(q(el, "profile-starting-zone")!.error).toBe(t("device_profiles.err_starting_zone"));
    await chooseOption(q(el, "profile-starting-zone")!, "z2");
    await flush(el);
    expect(q(el, "profile-starting-zone")!.error).toBe("");
    expect(bottom(el)).toBeNull();
  });

  it("says a refusal that names no field at the bottom", async () => {
    const { el } = await openEdit(profiles[0]!, {
      updateDeviceProfile: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    rename(el);
    await save(el);
    expect(bottom(el)).toBe(codeMessage("connection.failed"));
  });

  it("keeps an open draft through a live refresh, and reloads the list after a save", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const el = await mount(api);
    q(el, "edit-p1")!.click();
    await flush(el);
    change(el, "profile-name", "Draft name");
    toggle(el, "profile-role-staff", false);
    await flush(el);
    vi.mocked(api.listStaff).mockResolvedValue([...staff, person("pe-new", "Nora", "manager")]);
    liveData.invalidate([
      { type: "persons", id: "pe-new" },
      { type: "device_profiles", id: "p1" },
    ]);
    await vi.waitFor(() => expect(api.listStaff).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(q(el, "profile-name")!.value).toBe("Draft name");
    expect(q(el, "profile-role-staff")!.checked).toBe(false);
    expect(text(el, "admitted-people")).toBe(
      t("device_profiles.admitted_people").replace("{names}", "Luis, Nora"),
    );
    const listReads = vi.mocked(api.listDeviceProfiles).mock.calls.length;
    await save(el);
    expect(q(el, "editor-form")).toBeNull();
    expect(vi.mocked(api.listDeviceProfiles).mock.calls.length).toBe(listReads + 1);
  });

  it("duplicates only the zones still switched on, moving the start onto one of them", async () => {
    const offZone: DeviceProfile = {
      ...profiles[0]!,
      allowedZoneIds: ["z1", "z4"],
      startingZoneId: "z4",
    };
    const api = stubApi({ listDeviceProfiles: vi.fn().mockResolvedValue([offZone]) });
    const el = await mount(api);
    q(el, "duplicate-p1")!.click();
    await flush(el);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![6]).toEqual({
      departmentId: "d1",
      allowedZoneIds: ["z1"],
      startingZoneId: "z1",
    });
  });

  it.each([
    [
      "its department is switched off",
      { ...scopeChoices, departments: [{ id: "d1", name: "Restaurante", active: false }] },
      ["z1"],
    ],
    ["none of its zones is still on", scopeChoices, ["z4"]],
  ] as const)(
    "duplicates no scope when %s, leaving the server to refuse the copy",
    async (_case, choices, zones) => {
      const api = stubApi({
        listDeviceProfiles: vi
          .fn()
          .mockResolvedValue([
            { ...profiles[0]!, allowedZoneIds: [...zones], startingZoneId: zones[0] },
          ]),
        getProfileScopeChoices: vi.fn().mockResolvedValue(choices),
      });
      const el = await mount(api);
      q(el, "duplicate-p1")!.click();
      await flush(el);
      expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![6]).toBeUndefined();
    },
  );

  it("reads the departments and zones when the editor opens, not while the list is showing", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const el = await mount(api);
    expect(api.getProfileScopeChoices).not.toHaveBeenCalled();
    q(el, "edit-p1")!.click();
    await flush(el);
    expect(api.getProfileScopeChoices).toHaveBeenCalledTimes(1);
    liveData.invalidate([
      { type: "departments", id: "d1" },
      { type: "floor_zones", id: "z1" },
    ]);
    await flush(el);
    expect(api.getProfileScopeChoices).toHaveBeenCalledTimes(1);
  });

  it("opens an edit with its stored zones even when the departments arrive after the click", async () => {
    let arrive!: (choices: ProfileScopeChoices) => void;
    const api = stubApi({
      getDeviceProfile: vi
        .fn()
        .mockResolvedValue({ ...profiles[0]!, allowedZoneIds: ["z2"], startingZoneId: "z2" }),
      getProfileScopeChoices: vi.fn(
        () => new Promise<ProfileScopeChoices>((resolve) => (arrive = resolve)),
      ),
    });
    const el = await mount(api);
    q(el, "edit-p1")!.click();
    await flush(el);
    arrive(scopeChoices);
    await flush(el);
    expect(q(el, "profile-every-zone")!.checked).toBe(false);
    expect(q(el, "profile-zone-z2")!.checked).toBe(true);
    expect(q(el, "profile-zone-z1")!.checked).toBe(false);
    expect(q(el, "profile-starting-zone")!.value).toBe("z2");
  });

  it("starts a new profile in the only department even when the departments arrive after the click", async () => {
    let arrive!: (choices: ProfileScopeChoices) => void;
    const api = stubApi({
      getProfileScopeChoices: vi.fn(
        () => new Promise<ProfileScopeChoices>((resolve) => (arrive = resolve)),
      ),
    });
    const el = await mount(api);
    q(el, "create")!.click();
    await flush(el);
    arrive(scopeChoices);
    await flush(el);
    expect(q(el, "profile-department")!.value).toBe("d1");
    expect(q(el, "profile-starting-zone")!.value).toBe("z1");
  });

  it("explains department and starting zone with a help button, and shows the meaning of each empty choice as chosen", async () => {
    const { el } = await openEdit(profiles[0]!);
    for (const field of ["profile-department", "profile-starting-zone"]) {
      const help = q(el, field)!.querySelector('wt-help-tooltip[slot="help"]');
      expect(help?.getAttribute("aria-label")).toBeTruthy();
      expect(help?.textContent?.trim()).toBeTruthy();
      expect((q(el, field) as unknown as Combobox).placeholder).toBe("");
    }
    for (const field of ["profile-starting-screen", "profile-person-pe-ana"]) {
      const box = q(el, field) as unknown as Combobox & { showEmptyOption: boolean };
      expect(box.showEmptyOption).toBe(true);
      expect(box.placeholder).toBe("");
    }
  });

  it("describes the every-zone switch by its hint", async () => {
    const { el } = await openEdit(profiles[0]!);
    expect((q(el, "profile-every-zone") as unknown as { description: string }).description).toBe(
      t("device_profiles.every_zone_hint").replace("{department}", "Restaurante"),
    );
  });

  it("copies where a profile serves, who signs in and its starting screen when it is duplicated", async () => {
    const narrowed: DeviceProfile = {
      ...profiles[0]!,
      capabilities: ["show-schedule"],
      allowedZoneIds: ["z2"],
      startingZoneId: "z2",
      admittedRoles: ["manager"],
      personExceptions: [{ personId: "pe-ana", admitted: true }],
      startingScreen: "show-schedule",
    };
    const api = stubApi({ listDeviceProfiles: vi.fn().mockResolvedValue([narrowed]) });
    const el = await mount(api);
    q(el, "duplicate-p1")!.click();
    await flush(el);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![6]).toEqual({
      departmentId: "d1",
      allowedZoneIds: ["z2"],
      startingZoneId: "z2",
      admittedRoles: ["manager"],
      personExceptions: [{ personId: "pe-ana", admitted: true }],
      startingScreen: "show-schedule",
    });
  });
});

describe("device-profiles-screen equipment defaults, drawers and card readers", () => {
  function printer(id: string, name: string, extra: Partial<Printer> = {}): Printer {
    return {
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
    };
  }

  const venuePrinters = [
    printer("pr1", "Barra", { hasCashDrawer: true }),
    printer("pr2", "Cocina"),
    printer("pr3", "Terraza"),
  ];

  const readers = [
    {
      id: "r1",
      provider: "acme",
      name: "Mostrador",
      active: true,
      canEnable: true,
      deviceCount: 0,
    },
    { id: "r2", provider: "acme", name: "Terraza", active: true, canEnable: true, deviceCount: 0 },
  ];

  const listedProfile: DeviceProfile = {
    ...profiles[0]!,
    receiptPrinterIds: ["pr2", "pr1"],
    paymentSlipPrinterIds: ["pr3"],
    receiptPrinterDefaultId: "pr1",
  };

  type Field = HTMLElement & {
    value: string;
    error: string;
    options: { value: string; label: string }[];
  };

  async function editListed(overrides: Partial<DashboardApi> = {}, profile = listedProfile) {
    const api = stubApi({
      listDeviceProfiles: vi.fn().mockResolvedValue([profile, profiles[1]]),
      getDeviceProfile: vi.fn().mockResolvedValue(profile),
      listPrinters: vi.fn().mockResolvedValue(venuePrinters),
      listReaders: vi.fn().mockResolvedValue(readers),
      getProfileReaders: vi.fn().mockResolvedValue({ readerIds: ["r1"], defaultReaderId: "r1" }),
      setProfileReaders: vi.fn().mockImplementation((_id, list) => Promise.resolve(list)),
      ...overrides,
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    await flush(el);
    return { api, el };
  }

  const field = (el: DeviceProfilesScreen, test: string) =>
    el.shadowRoot!.querySelector(`[data-test=${test}]`) as Field;

  async function save(el: DeviceProfilesScreen) {
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    await flush(el);
  }

  function savedExtras(api: DashboardApi) {
    return vi.mocked(api.updateDeviceProfile).mock.calls[0]![7];
  }

  it("offers each list's own printers as its default, None first, and shows the stored default", async () => {
    const { el } = await editListed();
    const receipt = field(el, "receipt-printers-default");
    expect(receipt.getAttribute("name")).toBe("receiptPrinterDefaultId");
    expect(receipt.value).toBe("pr1");
    expect(receipt.options).toEqual([
      { value: "", label: t("device_profiles.default_none") },
      { value: "pr2", label: "Cocina" },
      { value: "pr1", label: "Barra" },
    ]);
    expect(field(el, "payment-slip-printers-default").value).toBe("");
  });

  it("saves each list's default", async () => {
    const { api, el } = await editListed();
    await chooseOption(field(el, "receipt-printers-default"), "pr2");
    await chooseOption(field(el, "payment-slip-printers-default"), "pr3");
    await flush(el);
    await save(el);
    expect(savedExtras(api)).toMatchObject({
      receiptPrinterDefaultId: "pr2",
      paymentSlipPrinterDefaultId: "pr3",
    });
    expect(savedExtras(api)).not.toHaveProperty("cashDrawerPrinterDefaultId");
  });

  it("sends no default or drawer list a save leaves alone", async () => {
    const { api, el } = await editListed();
    await expectSaveQuiet(el);
    rename(el);
    await save(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledTimes(1);
    const extras = savedExtras(api) ?? {};
    for (const key of [
      "cashDrawerPrinterIds",
      "receiptPrinterDefaultId",
      "paymentSlipPrinterDefaultId",
      "cashDrawerPrinterDefaultId",
    ])
      expect(extras).not.toHaveProperty(key);
  });

  it("unlisting the default sets it to None", async () => {
    const { api, el } = await editListed();
    toggle(el, "receipt-printers-pr1", false);
    await flush(el);
    expect(field(el, "receipt-printers-default").value).toBe("");
    await save(el);
    expect(savedExtras(api)).toMatchObject({ receiptPrinterDefaultId: null });
  });

  it("the drawer list offers only printers with a drawer and marks a listed one without", async () => {
    const { el } = await editListed({}, { ...listedProfile, cashDrawerPrinterIds: ["pr2"] });
    const drawers = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement & { label: string; checked: boolean }>(
        "[data-test=cash-drawer-printers] wt-switch[data-printer-id]",
      ),
    ];
    expect(drawers.map((s) => [s.dataset.printerId, s.label, s.checked])).toEqual([
      ["pr2", `Cocina (${t("device_profiles.no_drawer_attached")})`, true],
      ["pr1", "Barra", false],
    ]);
  });

  it("saves the drawer list and its default", async () => {
    const { api, el } = await editListed();
    toggle(el, "cash-drawer-printers-pr1", true);
    await flush(el);
    await chooseOption(field(el, "cash-drawer-printers-default"), "pr1");
    await flush(el);
    await save(el);
    expect(savedExtras(api)).toMatchObject({
      cashDrawerPrinterIds: ["pr1"],
      cashDrawerPrinterDefaultId: "pr1",
    });
  });

  it("a default_not_listed refusal shows under its field", async () => {
    const { el } = await editListed({
      updateDeviceProfile: vi.fn().mockRejectedValue({
        code: "device_profile.invalid",
        params: { reason: "default_not_listed", field: "receiptPrinterDefaultId" },
      }),
    });
    rename(el);
    await save(el);
    expect(field(el, "receipt-printers-default").error).toBe(
      t("device_profiles.err_default_not_listed"),
    );
    expect(field(el, "payment-slip-printers-default").error).toBe("");
  });

  it("a no_cash_drawer refusal shows under the drawer list", async () => {
    const { el } = await editListed({
      updateDeviceProfile: vi.fn().mockRejectedValue({
        code: "device_profile.invalid",
        params: { reason: "no_cash_drawer", field: "cashDrawerPrinterIds" },
      }),
    });
    rename(el);
    await save(el);
    expect(
      el.shadowRoot!.querySelector("[data-test=cash-drawer-printers-error]")?.textContent?.trim(),
    ).toBe(t("device_profiles.err_no_cash_drawer"));
  });

  it("lists the venue's card readers, the profile's switched on, with its default", async () => {
    const { el } = await editListed();
    const switches = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement & { checked: boolean; label: string }>(
        "[data-test=profile-readers] wt-switch",
      ),
    ];
    expect(switches.map((s) => [s.label, s.checked])).toEqual([
      ["Mostrador", true],
      ["Terraza", false],
    ]);
    const fallback = field(el, "profile-readers-default");
    expect(fallback.getAttribute("name")).toBe("defaultReaderId");
    expect(fallback.value).toBe("r1");
  });

  it("saves the reader list after the profile, and only when it changed", async () => {
    const { api, el } = await editListed();
    toggle(el, "profile-reader-r2", true);
    await flush(el);
    await chooseOption(field(el, "profile-readers-default"), "r2");
    await flush(el);
    await save(el);
    expect(api.setProfileReaders).toHaveBeenCalledExactlyOnceWith("p1", {
      readerIds: ["r1", "r2"],
      defaultReaderId: "r2",
    });
    expect(vi.mocked(api.updateDeviceProfile).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(api.setProfileReaders).mock.invocationCallOrder[0]!,
    );
    cleanupWidgets();
    const unchanged = await editListed();
    rename(unchanged.el);
    await save(unchanged.el);
    expect(unchanged.api.updateDeviceProfile).toHaveBeenCalledTimes(1);
    expect(unchanged.api.setProfileReaders).not.toHaveBeenCalled();
  });

  it("a failed reader save is said at the bottom, and the profile stays saved", async () => {
    const { api, el } = await editListed({
      setProfileReaders: vi.fn().mockRejectedValue({ code: "reader.not_found" }),
    });
    toggle(el, "profile-reader-r2", true);
    await flush(el);
    await save(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain(codeMessage("reader.not_found"));
  });

  it("the reader section is absent without the payments permission", async () => {
    const notPermitted = { code: "authorization.not_permitted" };
    const { api, el } = await editListed({
      getProfileReaders: vi.fn().mockRejectedValue(notPermitted),
      listReaders: vi.fn().mockRejectedValue(notPermitted),
    });
    expect(el.shadowRoot!.querySelector("[data-test=profile-readers]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    rename(el);
    await save(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledTimes(1);
    expect(api.setProfileReaders).not.toHaveBeenCalled();
  });

  const bottom = (el: DeviceProfilesScreen) =>
    el.shadowRoot!.querySelector(".form-message")?.textContent?.trim() ?? null;

  function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  } {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("an invalid-profile refusal naming neither a field nor a reason is said at the bottom", async () => {
    const { el } = await editListed({
      updateDeviceProfile: vi
        .fn()
        .mockRejectedValue({ code: "device_profile.invalid", params: {} }),
    });
    rename(el);
    await save(el);
    expect(bottom(el)).toBe(codeMessage("device_profile.invalid"));
    for (const test of [
      "receipt-printers-default",
      "payment-slip-printers-default",
      "profile-readers-default",
    ])
      expect(field(el, test).error).toBe("");
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).not.toBeNull();
  });

  it("card readers that cannot be read are said, draw no reader section, and the profile still saves", async () => {
    const { api, el } = await editListed({
      listReaders: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    expect(el.shadowRoot!.querySelector("[data-test=profile-readers]")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(codeMessage("connection.failed"));
    rename(el);
    await save(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledTimes(1);
    expect(api.setProfileReaders).not.toHaveBeenCalled();
  });

  it("card readers that fail to read after the editor was cancelled say nothing on the list", async () => {
    const readers = deferred<never>();
    const { el } = await editListed({ listReaders: vi.fn().mockReturnValue(readers.promise) });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
    readers.reject({ code: "connection.failed" });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(codeMessage("connection.failed"));
  });

  it("switching off the default reader sets the default to None", async () => {
    const { api, el } = await editListed();
    expect(field(el, "profile-readers-default").value).toBe("r1");
    toggle(el, "profile-reader-r1", false);
    await flush(el);
    expect(field(el, "profile-readers-default").value).toBe("");
    await save(el);
    expect(api.setProfileReaders).toHaveBeenCalledExactlyOnceWith("p1", {
      readerIds: [],
      defaultReaderId: null,
    });
  });

  it("a refused reader save that names the default shows under the default reader, keeping the editor", async () => {
    const { api, el } = await editListed({
      setProfileReaders: vi.fn().mockRejectedValue({
        code: "device_profile.invalid",
        params: { field: "defaultReaderId", reason: "default_not_listed" },
      }),
    });
    toggle(el, "profile-reader-r2", true);
    await flush(el);
    await save(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledTimes(1);
    expect(field(el, "profile-readers-default").error).toBe(
      t("device_profiles.err_default_not_listed"),
    );
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).not.toBeNull();
  });

  describe("a reader save answering after the screen was left", () => {
    async function leaveWhileReadersSave(answer: Promise<unknown>) {
      const { api, el } = await editListed({
        setProfileReaders: vi.fn().mockReturnValue(answer),
      });
      toggle(el, "profile-reader-r2", true);
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
      await vi.waitFor(() => expect(api.setProfileReaders).toHaveBeenCalledTimes(1));
      el.remove();
      return { api, el, reads: vi.mocked(api.listDeviceProfiles).mock.calls.length };
    }

    it("reads no profiles once it is saved", async () => {
      const answer = deferred<ProfileReaderList>();
      const { api, el, reads } = await leaveWhileReadersSave(answer.promise);
      answer.resolve({ readerIds: ["r1", "r2"], defaultReaderId: "r1" });
      await flush(el);
      await flush(el);
      expect(vi.mocked(api.listDeviceProfiles).mock.calls.length).toBe(reads);
    });

    it("says nothing when it is refused", async () => {
      const answer = deferred<ProfileReaderList>();
      const { el } = await leaveWhileReadersSave(answer.promise);
      answer.reject({ code: "reader.not_found" });
      await flush(el);
      await flush(el);
      expect(el.shadowRoot!.textContent).not.toContain(codeMessage("reader.not_found"));
    });
  });

  it("marks a listed reader that is switched off, and draws none the reader list did not deliver", async () => {
    const { el } = await editListed({
      listReaders: vi.fn().mockResolvedValue([{ ...readers[0]!, active: false }, readers[1]!]),
      getProfileReaders: vi
        .fn()
        .mockResolvedValue({ readerIds: ["r9", "r1"], defaultReaderId: "r1" }),
    });
    const switches = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement & { checked: boolean; label: string }>(
        "[data-test=profile-readers] wt-switch",
      ),
    ];
    const off = `Mostrador (${t("devices.watcher_disabled_mark")})`;
    expect(switches.map((s) => [s.dataset.test, s.label, s.checked])).toEqual([
      ["profile-reader-r1", off, true],
      ["profile-reader-r2", "Terraza", false],
    ]);
    expect(field(el, "profile-readers-default").options).toEqual([
      { value: "", label: t("device_profiles.default_none") },
      { value: "r1", label: off },
    ]);
  });

  it("a duplicate copies the profile's cash drawer list", async () => {
    const withDrawer: DeviceProfile = { ...listedProfile, cashDrawerPrinterIds: ["pr1"] };
    const { api } = await duplicateListed({
      listDeviceProfiles: vi.fn().mockResolvedValue([withDrawer, profiles[1]]),
    });
    expect(api.createDeviceProfile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![6]).toMatchObject({
      cashDrawerPrinterIds: ["pr1"],
    });
  });

  async function duplicateListed(overrides: Partial<DashboardApi> = {}) {
    const api = stubApi({
      listDeviceProfiles: vi.fn().mockResolvedValue([listedProfile, profiles[1]]),
      listPrinters: vi.fn().mockResolvedValue(venuePrinters),
      listReaders: vi.fn().mockResolvedValue(readers),
      getProfileReaders: vi
        .fn()
        .mockResolvedValue({ readerIds: ["r1", "r2"], defaultReaderId: "r2" }),
      setProfileReaders: vi.fn().mockImplementation((_id, list) => Promise.resolve(list)),
      ...overrides,
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=duplicate-p1]")!.click();
    await flush(el);
    await flush(el);
    return { api, el };
  }

  it("a duplicate copies the reader list and its default onto the new profile", async () => {
    const { api } = await duplicateListed();
    expect(api.getProfileReaders).toHaveBeenCalledWith("p1");
    expect(api.setProfileReaders).toHaveBeenCalledExactlyOnceWith("p9", {
      readerIds: ["r1", "r2"],
      defaultReaderId: "r2",
    });
    expect(vi.mocked(api.createDeviceProfile).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(api.setProfileReaders).mock.invocationCallOrder[0]!,
    );
  });

  it("a duplicate whose reader copy fails says so at the bottom, and the copy stays", async () => {
    const { api, el } = await duplicateListed({
      setProfileReaders: vi.fn().mockRejectedValue({ code: "reader.not_found" }),
    });
    expect(api.createDeviceProfile).toHaveBeenCalledTimes(1);
    expect(api.deleteDeviceProfile).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim()).toBe(
      codeMessage("reader.not_found"),
    );
  });

  it.each([
    [
      "without the payments permission",
      vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    ],
    [
      "when the profile lists no reader",
      vi.fn().mockResolvedValue({ readerIds: [], defaultReaderId: null }),
    ],
  ])("a duplicate copies no reader list %s, and says nothing", async (_when, getProfileReaders) => {
    const { api, el } = await duplicateListed({ getProfileReaders });
    expect(api.createDeviceProfile).toHaveBeenCalledTimes(1);
    expect(api.setProfileReaders).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });
});

for (const locale of ["en", "es"]) {
  for (const separator of [".", ","]) {
    it(`decimal input inactivity accepts ${separator} and displays ${locale}`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const phone: DeviceProfile = {
          ...profiles[0]!,
          formFactor: "phone-portrait",
          inactivityTimeoutSeconds: 90,
        };
        const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(phone) });
        const el = await mount(api);
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
        await flush(el);
        const control = el.shadowRoot!.querySelector<
          HTMLElement & { updateComplete: Promise<unknown> }
        >("[data-test=profile-inactivity]")!;
        await control.updateComplete;
        const native = control.shadowRoot!.querySelector("input")!;
        expect(native.value).toBe(locale === "es" ? "1,5" : "1.5");
        native.value = `2${separator}5`;
        native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        await el.updateComplete;
        await control.updateComplete;
        expect(native.value).toBe(locale === "es" ? "2,5" : "2.5");
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
        await flush(el);
        expect(api.updateDeviceProfile).toHaveBeenCalledWith(
          "p1",
          "Front counter",
          "c1",
          ["integrated-card-payment", "open-cash-drawer"],
          "phone-portrait",
          150,
          NO_PRINTERS,
        );
      } finally {
        setLocale(previous);
      }
    });
  }
}

it("decimal input inactivity refuses ambiguous marks without clearing the timeout", async () => {
  const phone: DeviceProfile = {
    ...profiles[0]!,
    formFactor: "phone-portrait",
    inactivityTimeoutSeconds: 90,
  };
  const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(phone) });
  const el = await mount(api);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
  await flush(el);
  const control = el.shadowRoot!.querySelector<
    HTMLElement & { error: string; updateComplete: Promise<unknown> }
  >("[data-test=profile-inactivity]")!;
  const save = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    "[data-test=profile-save]",
  )!;
  for (const bad of ["1,2,3", "1.234,5", "1 234,5"]) {
    const native = control.shadowRoot!.querySelector("input")!;
    native.value = bad;
    native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    save.click();
    await el.updateComplete;
    expect(api.updateDeviceProfile).not.toHaveBeenCalled();
    expect(control.error).not.toBe("");
    expect(save.disabled).toBe(true);
    expect(native.value).toBe(bad);
  }
  change(el, "profile-inactivity", "2.5");
  await el.updateComplete;
  expect(control.error).toBe("");
  expect(save.disabled).toBe(false);
});

describe("the printer lists while the venue's printers are not read", () => {
  const loading = { en: "Loading printers…", es: "Cargando impresoras…" } as const;
  const bottom = (el: DeviceProfilesScreen) =>
    el.shadowRoot!.querySelector(".form-message")?.textContent?.trim() ?? null;
  const loadingLine = (el: DeviceProfilesScreen) =>
    el.shadowRoot!.querySelector("[data-test=printers-loading]");
  const noPrinters = (el: DeviceProfilesScreen) =>
    el.shadowRoot!.querySelector("[data-test=no-printers]");

  for (const locale of ["en", "es"] as const) {
    it(`says the printers are loading, not to add one, while they load (${locale})`, async () => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const el = await mount(
          stubApi({ listPrinters: vi.fn().mockReturnValue(new Promise(() => undefined)) }),
        );
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
        await flush(el);
        expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).not.toBeNull();
        expect(noPrinters(el)).toBeNull();
        expect(loadingLine(el)?.getAttribute("role")).toBe("status");
        expect(loadingLine(el)?.textContent?.trim()).toBe(loading[locale]);
      } finally {
        setLocale(previous);
      }
    });
  }

  for (const open of ["create", "edit-p1"]) {
    it(`shows a failed printer read as the form's load failure, not as no printers (${open})`, async () => {
      const el = await mount(
        stubApi({ listPrinters: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      );
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim()).toBe(
          codeMessage("connection.failed"),
        ),
      );
      el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${open}]`)!.click();
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).not.toBeNull();
      expect(noPrinters(el)).toBeNull();
      expect(loadingLine(el)).toBeNull();
      expect(bottom(el)).toBe(codeMessage("connection.failed"));
    });
  }

  it("draws the printer lists and drops the failure once a later read succeeds", async () => {
    const liveData = new LiveData();
    const listPrinters = vi.fn().mockRejectedValue({ code: "connection.failed" });
    const el = await mount(stubApi({ listPrinters, liveData } as Partial<DashboardApi>));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    expect(bottom(el)).toBe(codeMessage("connection.failed"));
    listPrinters.mockResolvedValue([
      { id: "pr1", name: "Barra", active: true, hasCashDrawer: false } as Printer,
    ]);
    liveData.refresh();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=receipt-printers]")).not.toBeNull(),
    );
    expect(bottom(el)).toBeNull();
    expect(noPrinters(el)).toBeNull();
  });

  it("keeps a later failed printer read on screen when the editor opens", async () => {
    const liveData = new LiveData();
    const listPrinters = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValue({ code: "connection.failed" });
    const el = await mount(stubApi({ listPrinters, liveData } as Partial<DashboardApi>));
    liveData.refresh();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim()).toBe(
        codeMessage("connection.failed"),
      ),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).not.toBeNull();
    expect(bottom(el)).toBe(codeMessage("connection.failed"));
    expect(noPrinters(el)).not.toBeNull();
  });

  it("shows a read failure a refused delete was covering once the editor opens", async () => {
    const liveData = new LiveData();
    const listPrinters = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValue({ code: "connection.failed" });
    const el = await mount(
      stubApi({
        listPrinters,
        liveData,
        deleteDeviceProfile: vi.fn().mockRejectedValue({ code: "device_profile.not_found" }),
      } as Partial<DashboardApi>),
    );
    const alert = () => el.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-p1]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await vi.waitFor(() => expect(alert()).toBe(codeMessage("device_profile.not_found")));
    liveData.refresh();
    await vi.waitFor(() => expect(listPrinters).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(alert()).toBe(codeMessage("device_profile.not_found"));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    expect(bottom(el)).toBe(codeMessage("connection.failed"));
  });
});
