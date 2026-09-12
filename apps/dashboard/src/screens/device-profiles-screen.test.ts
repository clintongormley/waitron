import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./device-profiles-screen.js";
import type { DeviceProfilesScreen } from "./device-profiles-screen.js";
import type { Canvas, DeviceProfile, DashboardApi } from "../api/client.js";

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
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=profile-canvas]")!;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function selectFormFactor(el: DeviceProfilesScreen, value: string) {
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>(
    "[data-test=profile-form-factor]",
  )!;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
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
    const options = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>(
        "[data-test=profile-form-factor] option",
      ),
    ];
    expect(options.map((o) => o.value)).toEqual([
      "till",
      "phone-portrait",
      "tablet-landscape",
      "kds",
    ]);
    // The shipped locale is es-ES; the four values map to their localised labels (the "till" value is
    // the cash register — never the raw token).
    const labels = options.map((o) => o.textContent!.trim());
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
    const formFactor = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "[data-test=profile-form-factor]",
    )!;
    expect(formFactor.value).toBe("till");
  });

  it("Edit pre-selects a non-default form factor and Save sends it via updateDeviceProfile", async () => {
    const kdsProfile: DeviceProfile = { ...profiles[0], formFactor: "kds" };
    const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(kdsProfile) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    const formFactor = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "[data-test=profile-form-factor]",
    )!;
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

  it("Edit → clearing the canvas select saves canvasId null (form-factor default)", async () => {
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
    // No timeout input for a kitchen display — it never idle-logs out.
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
