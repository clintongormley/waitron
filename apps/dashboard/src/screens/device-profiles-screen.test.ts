import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./device-profiles-screen.js";
import type { DeviceProfilesScreen } from "./device-profiles-screen.js";
import type { Canvas, DeviceProfile, DashboardApi, Printer } from "../api/client.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(cleanupWidgets);

const canvases: Canvas[] = [
  { id: "c1", name: "Counter till", definition: {} },
  { id: "c2", name: "Kitchen board", definition: {} },
];

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
  },
];

const NO_PRINTERS = { receiptPrinterIds: [], paymentSlipPrinterIds: [] };

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listDeviceProfiles: vi.fn().mockResolvedValue(profiles),
    getDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    createDeviceProfile: vi.fn().mockResolvedValue({ ...profiles[0], id: "p9" }),
    updateDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    deleteDeviceProfile: vi.fn().mockResolvedValue(undefined),
    listCanvases: vi.fn().mockResolvedValue(canvases),
    listPrinters: vi.fn().mockResolvedValue([]),
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
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Front counter",
      "c1",
      ["integrated-card-payment", "open-cash-drawer"],
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
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Front counter",
      "c1",
      ["integrated-card-payment", "open-cash-drawer"],
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
    expect(api.createDeviceProfile).toHaveBeenCalledWith("Caja", null, [], "till", null, {
      receiptPrinterIds: ["pr2"],
      paymentSlipPrinterIds: ["pr1"],
    });
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
