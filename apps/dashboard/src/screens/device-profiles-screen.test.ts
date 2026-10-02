import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./device-profiles-screen.js";
import type { DeviceProfilesScreen } from "./device-profiles-screen.js";
import type { Canvas, DeviceMenuHomeLayouts, DeviceProfile, DashboardApi } from "../api/client.js";
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
  },
  {
    id: "p2",
    name: "Kitchen",
    canvasId: null,
    capabilities: [],
    formFactor: "kds",
    inactivityTimeoutSeconds: null,
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listDeviceProfiles: vi.fn().mockResolvedValue(profiles),
    getDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    createDeviceProfile: vi.fn().mockResolvedValue({ ...profiles[0], id: "p9" }),
    updateDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    deleteDeviceProfile: vi.fn().mockResolvedValue(undefined),
    listCanvases: vi.fn().mockResolvedValue(canvases),
    getDeviceHomeLayouts: vi.fn().mockResolvedValue([]),
    setDeviceHomeLayout: vi.fn().mockResolvedValue(undefined),
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
    );
  });

  it("draws a Schedule screen switch whose save sends show-schedule", async () => {
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
    expect(api.createDeviceProfile).toHaveBeenCalledWith("Counter", null, [], "till", null);
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
    );
  });

  it("picks a menu's home page layout from a dropdown labelled with the menu, Default as its prompt", async () => {
    let refuse!: (error: unknown) => void;
    const api = stubApi({
      getDeviceHomeLayouts: vi.fn().mockResolvedValue([
        {
          menuId: "m-lunch",
          menuName: "Lunch",
          layouts: [
            { id: "l-home", name: "Home", isDefault: true },
            { id: "l-counter", name: "Counter", isDefault: false },
          ],
          selectedLayoutId: null,
          selectedRemoved: false,
        },
      ]),
      setDeviceHomeLayout: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            refuse = reject;
          }),
      ),
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await vi.waitFor(() => expect(box(el, '[name="home-layout-m-lunch"]')).not.toBeNull());

    const home = box(el, '[name="home-layout-m-lunch"]')!;
    const fallback = t("device_profiles.home_default").replace("{name}", "Home");
    expect(home.label).toBe("Lunch");
    expect(home.search).toBe("auto");
    expect(home.placeholder).toBe(fallback);
    expect(home.options).toEqual([
      { value: "", label: fallback },
      { value: "l-counter", label: "Counter" },
    ]);
    expect(home.value).toBe("");
    expect(home.error).toBe("");

    await chooseOption(home, "l-counter");
    await flush(el);
    expect(api.setDeviceHomeLayout).toHaveBeenCalledWith("p1", "m-lunch", "l-counter");
    expect(home.disabled).toBe(true);
    refuse({ code: "menu.layout_not_found" });
    await vi.waitFor(() => expect(home.error).toBe(codeMessage("menu.layout_not_found")));
    expect(home.disabled).toBe(false);
    expect(home.value).toBe("");
  });
});

describe("device-profiles-screen home page layouts", () => {
  /** Lunch has three layouts and no choice; Dinner has one layout; Bar's choice was deleted;
   * Brunch's choice is its current default, by id. */
  function homeMenus(): DeviceMenuHomeLayouts[] {
    return [
      {
        menuId: "m-bar",
        menuName: "Bar",
        layouts: [
          { id: "l-bar", name: "Bar home", isDefault: true },
          { id: "l-late", name: "Late", isDefault: false },
        ],
        selectedLayoutId: "l-old",
        selectedRemoved: true,
      },
      {
        menuId: "m-brunch",
        menuName: "Brunch",
        layouts: [
          { id: "l-brunch", name: "Brunch home", isDefault: true },
          { id: "l-kids", name: "Kids", isDefault: false },
        ],
        selectedLayoutId: "l-brunch",
        selectedRemoved: false,
      },
      {
        menuId: "m-dinner",
        menuName: "Dinner",
        layouts: [{ id: "l-evening", name: "Evening", isDefault: true }],
        selectedLayoutId: null,
        selectedRemoved: false,
      },
      {
        menuId: "m-lunch",
        menuName: "Lunch",
        layouts: [
          { id: "l-home", name: "Home", isDefault: true },
          { id: "l-counter", name: "Counter", isDefault: false },
          { id: "l-terrace", name: "Terrace", isDefault: false },
        ],
        selectedLayoutId: null,
        selectedRemoved: false,
      },
    ];
  }

  type Stub = DashboardApi & {
    getDeviceHomeLayouts: ReturnType<typeof vi.fn>;
    setDeviceHomeLayout: ReturnType<typeof vi.fn>;
  };

  function homeApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): Stub {
    return stubApi({
      getDeviceHomeLayouts: vi.fn().mockResolvedValue(homeMenus()),
      ...overrides,
    } as Partial<DashboardApi>) as Stub;
  }

  async function edit(api: DashboardApi) {
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await vi.waitFor(() => {
      if (!el.shadowRoot!.querySelector("[data-test=home-layouts]")) throw new Error("editor");
    });
    await flush(el);
    return el;
  }

  function picker(el: DeviceProfilesScreen, menuId: string): Combobox | null {
    return el.shadowRoot!.querySelector<Combobox>(`wt-combobox[name="home-layout-${menuId}"]`);
  }

  async function options(
    el: DeviceProfilesScreen,
    menuId: string,
  ): Promise<[string, string, boolean][]> {
    const box = picker(el, menuId)!;
    await box.updateComplete;
    const shown = box.shadowRoot!.querySelector(".trigger .value")!.textContent!.trim();
    return box.options.map((option) => [
      option.value,
      option.label.trim(),
      option.value === box.value && option.label.trim() === shown,
    ]);
  }

  /** The picker's own control, which carries its invalid state and what describes it. */
  function control(el: DeviceProfilesScreen, menuId: string): HTMLElement {
    return picker(el, menuId)!.shadowRoot!.querySelector<HTMLElement>(".trigger")!;
  }

  async function choose(el: DeviceProfilesScreen, menuId: string, value: string): Promise<void> {
    await chooseOption(picker(el, menuId)!, value);
    await flush(el);
  }

  function inHome(el: DeviceProfilesScreen, selector: string): HTMLElement | null {
    return el.shadowRoot!.querySelector<HTMLElement>(`[data-test=home-layouts] ${selector}`);
  }

  it("offers a picker per menu with more than one layout: Default, then each other layout", async () => {
    const api = homeApi();
    const el = await edit(api);
    expect(api.getDeviceHomeLayouts).toHaveBeenCalledWith("p1");
    expect(picker(el, "m-dinner")).toBeNull();
    const defaultHome = t("device_profiles.home_default").replace("{name}", "Home");
    expect(await options(el, "m-lunch")).toEqual([
      ["", defaultHome, true],
      ["l-counter", "Counter", false],
      ["l-terrace", "Terrace", false],
    ]);
    expect(picker(el, "m-lunch")!.label).toContain("Lunch");
  });

  it("saves a chosen layout, and Default clears the choice", async () => {
    const api = homeApi();
    const el = await edit(api);
    await choose(el, "m-lunch", "l-counter");
    await vi.waitFor(() =>
      expect(api.setDeviceHomeLayout).toHaveBeenCalledWith("p1", "m-lunch", "l-counter"),
    );
    await vi.waitFor(() => expect(api.getDeviceHomeLayouts).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(inHome(el, "[data-test=home-saved]")?.textContent?.trim()).toBe(
        t("device_profiles.home_saved").replace("{menu}", "Lunch"),
      ),
    );
    await choose(el, "m-lunch", "");
    await vi.waitFor(() =>
      expect(api.setDeviceHomeLayout).toHaveBeenLastCalledWith("p1", "m-lunch", null),
    );
    // The profile's own fields are not saved by a layout choice.
    expect(api.updateDeviceProfile).not.toHaveBeenCalled();
  });

  it("shows a choice whose layout was deleted as removed, with a reset that saves Default", async () => {
    const api = homeApi();
    const el = await edit(api);
    expect(await options(el, "m-bar")).toEqual([
      ["", t("device_profiles.home_default").replace("{name}", "Bar home"), false],
      ["l-late", "Late", false],
      ["l-old", t("device_profiles.home_removed"), true],
    ]);
    // A deleted layout's id means nothing to a person, so it is never shown.
    expect((await options(el, "m-bar"))[2]![1]).not.toContain("l-old");
    expect(inHome(el, "[data-test=home-removed-m-bar]")!.textContent!.trim()).toBe(
      t("device_profiles.home_removed_note").replace("{menu}", "Bar"),
    );
    inHome(el, "[data-test=home-reset-m-bar]")!.click();
    await vi.waitFor(() =>
      expect(api.setDeviceHomeLayout).toHaveBeenCalledWith("p1", "m-bar", null),
    );
    expect(inHome(el, "[data-test=home-reset-m-lunch]")).toBeNull();
  });

  it("shows a choice of the menu's current default by its name, apart from Default", async () => {
    const el = await edit(homeApi());
    expect(await options(el, "m-brunch")).toEqual([
      ["", t("device_profiles.home_default").replace("{name}", "Brunch home"), false],
      ["l-brunch", "Brunch home", true],
      ["l-kids", "Kids", false],
    ]);
  });

  it("shows a picker for a one-layout menu whose saved choice is no longer its layout", async () => {
    const menus = homeMenus();
    menus[2] = { ...menus[2]!, selectedLayoutId: "l-gone", selectedRemoved: true };
    const el = await edit(homeApi({ getDeviceHomeLayouts: vi.fn().mockResolvedValue(menus) }));
    expect((await options(el, "m-dinner")).map(([value]) => value)).toEqual(["", "l-gone"]);
  });

  it("puts a refused choice beside its picker, and holds the picker while the choice is out", async () => {
    let refuse!: (error: unknown) => void;
    const api = homeApi({
      setDeviceHomeLayout: vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            refuse = reject;
          }),
      ),
    });
    const el = await edit(api);
    await choose(el, "m-lunch", "l-terrace");
    expect(picker(el, "m-lunch")!.disabled).toBe(true);
    refuse({ code: "menu.layout_not_found" });
    await vi.waitFor(() =>
      expect(picker(el, "m-lunch")!.error.trim()).toBe(codeMessage("menu.layout_not_found")),
    );
    const select = picker(el, "m-lunch")!;
    expect(select.disabled).toBe(false);
    // The picker goes back to the choice that is still saved.
    expect(select.value).toBe("");
    expect(control(el, "m-lunch").getAttribute("aria-invalid")).toBe("true");
    expect(
      select
        .shadowRoot!.getElementById(control(el, "m-lunch").getAttribute("aria-describedby")!)!
        .textContent!.trim(),
    ).toBe(codeMessage("menu.layout_not_found"));
    expect(control(el, "m-bar").getAttribute("aria-invalid")).toBe("false");
  });

  it("clears a menu's refusal when a new choice for it is saved, leaving other menus' alone", async () => {
    const api = homeApi({
      setDeviceHomeLayout: vi
        .fn()
        .mockRejectedValueOnce({ code: "menu.layout_not_found" })
        .mockRejectedValueOnce({ code: "catalogue.not_found" })
        .mockResolvedValue(undefined),
    });
    const el = await edit(api);
    await choose(el, "m-lunch", "l-terrace");
    await vi.waitFor(() => expect(picker(el, "m-lunch")!.error).not.toBe(""));
    await choose(el, "m-brunch", "l-kids");
    await vi.waitFor(() => expect(picker(el, "m-brunch")!.error).not.toBe(""));
    await choose(el, "m-lunch", "l-counter");
    await vi.waitFor(() =>
      expect(inHome(el, "[data-test=home-saved]")?.textContent).toContain("Lunch"),
    );
    expect(picker(el, "m-lunch")!.error).toBe("");
    expect(picker(el, "m-brunch")!.error).not.toBe("");
  });

  it("sends one choice while one is out", async () => {
    let finish!: () => void;
    const api = homeApi({
      setDeviceHomeLayout: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const el = await edit(api);
    await choose(el, "m-lunch", "l-counter");
    inHome(el, "[data-test=home-reset-m-bar]")!.click();
    expect(api.setDeviceHomeLayout).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(picker(el, "m-lunch")!.disabled).toBe(false));
  });

  it("reads nothing more when a choice is saved after the profile was closed", async () => {
    let finish!: () => void;
    const api = homeApi({
      setDeviceHomeLayout: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const el = await edit(api);
    await choose(el, "m-lunch", "l-counter");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await flush(el);
    const reads = api.getDeviceHomeLayouts.mock.calls.length;
    finish();
    await flush(el);
    expect(api.getDeviceHomeLayouts.mock.calls.length).toBe(reads);
    expect(el.shadowRoot!.querySelector("[data-test=home-saved]")).toBeNull();
  });

  it("offers a plain Default for a menu with no layout left, whose saved choice was deleted", async () => {
    const menus = homeMenus();
    menus[2] = { ...menus[2]!, layouts: [], selectedLayoutId: "l-gone", selectedRemoved: true };
    const el = await edit(homeApi({ getDeviceHomeLayouts: vi.fn().mockResolvedValue(menus) }));
    expect((await options(el, "m-dinner"))[0]).toEqual([
      "",
      t("device_profiles.home_default_plain"),
      false,
    ]);
  });

  it("a choice that saved but could not then be read back is a load failure, not a refusal", async () => {
    const api = homeApi();
    const el = await edit(api);
    api.getDeviceHomeLayouts.mockRejectedValue(new Error("offline"));
    await choose(el, "m-lunch", "l-counter");
    await vi.waitFor(() => expect(inHome(el, "[data-test=home-load-error]")).not.toBeNull());
    expect(picker(el, "m-lunch")!.error).toBe("");
  });

  it("says the layouts could not be loaded, and tries again", async () => {
    const api = homeApi({
      getDeviceHomeLayouts: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(homeMenus()),
    });
    const el = await edit(api);
    await vi.waitFor(() =>
      expect(inHome(el, "[data-test=home-load-error]")?.textContent?.trim()).toBe(
        t("device_profiles.home_error"),
      ),
    );
    inHome(el, "[data-test=home-retry]")!.click();
    await vi.waitFor(() => expect(picker(el, "m-lunch")).not.toBeNull());
    expect(inHome(el, "[data-test=home-load-error]")).toBeNull();
  });

  it("says the layouts are loading until they are read", async () => {
    const el = await edit(homeApi({ getDeviceHomeLayouts: vi.fn(() => new Promise(() => {})) }));
    expect(inHome(el, "[data-test=home-loading]")).not.toBeNull();
  });

  it("says there is nothing to choose when no menu has more than one layout", async () => {
    const el = await edit(
      homeApi({ getDeviceHomeLayouts: vi.fn().mockResolvedValue([homeMenus()[2]!]) }),
    );
    expect(inHome(el, "[data-test=home-none]")!.textContent!.trim()).toBe(
      t("device_profiles.home_none"),
    );
  });

  it("asks a new profile to be saved first, reading no layouts", async () => {
    const api = homeApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    expect(inHome(el, "[data-test=home-new]")!.textContent!.trim()).toBe(
      t("device_profiles.home_new"),
    );
    expect(api.getDeviceHomeLayouts).not.toHaveBeenCalled();
  });

  it("follows the layouts while the profile is open, and stops once it is closed", async () => {
    const live = new LiveData();
    const api = homeApi({ liveData: live });
    const el = await edit(api);
    const renamed = homeMenus();
    renamed[3]!.layouts[1]!.name = "Bar counter";
    api.getDeviceHomeLayouts.mockResolvedValue(renamed);
    live.invalidate([{ type: "device_profile_home_layouts" }]);
    await vi.waitFor(async () =>
      expect((await options(el, "m-lunch")).map(([, label]) => label)).toContain("Bar counter"),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await flush(el);
    const reads = api.getDeviceHomeLayouts.mock.calls.length;
    live.invalidate([{ type: "device_profile_home_layouts" }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.getDeviceHomeLayouts.mock.calls.length).toBe(reads);
  });
});
