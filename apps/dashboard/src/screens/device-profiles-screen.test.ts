import {
  selectProfileTab,
  profileAction,
  profileListRoot,
  withProfileListRead,
} from "../testing/profile-table.js";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./device-profiles-screen.js";
import type { DeviceProfilesScreen } from "./device-profiles-screen.js";
import type {
  DeviceProfile,
  DashboardApi,
  JobRole,
  PersonRole,
  PersonSummary,
  PagePrinterRow,
  Printer,
  ProfileKitchenScreens,
  ProfileReaderList,
  ProfileScopeChoices,
  ReaderRow,
  Station,
} from "../api/client.js";
import { DashboardApi as RealDashboardApi } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

/** The screen's text with its Save row's, which draws the form's message. */
function shownText(el: DeviceProfilesScreen): string {
  const row = el.shadowRoot!.querySelector("wt-form-actions");
  return `${el.shadowRoot!.textContent ?? ""}${row?.shadowRoot?.textContent ?? ""}`;
}

/** Finds `selector` in the screen, or in the editor's Save row, which draws the form's message. */
function inScreenOrRow(el: DeviceProfilesScreen, selector: string): Element | null {
  return (
    el.shadowRoot!.querySelector(selector) ??
    el.shadowRoot!.querySelector("wt-form-actions")?.shadowRoot?.querySelector(selector) ??
    null
  );
}

afterEach(cleanupWidgets);

/** Where and for whom a profile with nothing narrowed serves: every zone, every role. */
const OPEN_ACCESS = {
  allowedZoneIds: null,
  admittedStaffRoleIds: ["job-waiter", "job-chef"],
  startingScreen: null,
};

const profiles: DeviceProfile[] = [
  {
    id: "p1",
    name: "Front counter",

    capabilities: ["integrated-card-payment", "open-cash-drawer"],
    formFactor: "till",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
    cashDrawerPrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
    invoicePrinterIds: [],
    invoicePrinterDefaultId: null,
    ...OPEN_ACCESS,
    departmentId: "d1",
    startingZoneId: "z1",
  },
  {
    id: "p2",
    name: "Kitchen",

    capabilities: [],
    formFactor: "kds",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
    cashDrawerPrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
    invoicePrinterIds: [],
    invoicePrinterDefaultId: null,
    ...OPEN_ACCESS,
    departmentId: null,
    startingZoneId: null,
  },
];

const NO_PRINTERS = { receiptPrinterIds: [], paymentSlipPrinterIds: [] };

/** The venue's one department and its zones, a switched-off one among them. */
const scopeChoices: ProfileScopeChoices = {
  departments: [{ id: "d1", name: "Restaurant", active: true }],
  zones: [
    { id: "z1", name: "Dining room", departmentId: "d1", active: true },
    { id: "z2", name: "Terrace", departmentId: "d1", active: true },
    { id: "z4", name: "Old bar", departmentId: "d1", active: false },
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
  return {
    personId,
    displayName,
    roleIds: [role],
    status,
    hasPassword: true,
    hasTotp: false,
    email: null,
  };
}

const staff = [
  person("pe-ana", "Ana", "staff"),
  person("pe-luis", "Luis", "manager"),
  person("pe-marta", "Marta", "supervisor", "suspended"),
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  const api = {
    listDeviceProfiles: vi.fn().mockResolvedValue(profiles),
    getDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    createDeviceProfile: vi.fn().mockResolvedValue({ ...profiles[0], id: "p9" }),
    copyDeviceProfile: vi.fn().mockResolvedValue({ ...profiles[0], id: "p9" }),
    updateDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    deleteDeviceProfile: vi.fn().mockResolvedValue(undefined),

    listPrinters: vi.fn().mockResolvedValue([]),
    listPagePrinters: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    listProfileKitchenScreens: vi.fn().mockResolvedValue([]),
    getProfileScopeChoices: vi.fn().mockResolvedValue(scopeChoices),
    listJobRoles: vi.fn().mockResolvedValue([
      { id: "job-waiter", name: "Waiter", colour: "grey", position: 0 },
      { id: "job-chef", name: "Chef", colour: "grey", position: 1 },
    ]),
    listStaff: vi.fn().mockResolvedValue(staff),
    listReaders: vi.fn().mockResolvedValue([]),
    getProfileReaders: vi.fn().mockResolvedValue({ readerIds: [], defaultReaderId: null }),
    setProfileReaders: vi.fn().mockResolvedValue({ readerIds: [], defaultReaderId: null }),
    ...overrides,
  } as unknown as DashboardApi;
  return withProfileListRead(api, scopeChoices);
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

function selectFormFactor(el: DeviceProfilesScreen, value: string) {
  void chooseOption(el.shadowRoot!.querySelector("[data-test=profile-form-factor]")!, value);
}

describe("device profile editor tabs", () => {
  it.each([390, 900, 1280])(
    "places actions and screens in columns that stack at %ipx",
    async (width) => {
      const viewport = { width: innerWidth, height: innerHeight };
      try {
        await page.viewport(width, 900);
        const el = await mount();
        await profileAction(el, "edit-p1");
        await flush(el);
        await selectProfileTab(el, "capabilities");
        const actions = el
          .shadowRoot!.querySelector("[data-test=profile-actions]")!
          .getBoundingClientRect();
        const screens = el
          .shadowRoot!.querySelector("[data-test=profile-screens]")!
          .getBoundingClientRect();
        if (width === 390) {
          expect(screens.left).toBe(actions.left);
          expect(screens.top).toBeGreaterThanOrEqual(actions.bottom);
        } else {
          expect(screens.top).toBe(actions.top);
          expect(screens.left).toBeGreaterThan(actions.right);
        }
      } finally {
        await page.viewport(viewport.width, viewport.height);
      }
    },
  );

  it.each(["till", "kds"] as const)(
    "groups a %s profile's fields and preserves its draft across tabs",
    async (formFactor) => {
      const api = stubApi({
        getDeviceProfile: vi.fn().mockResolvedValue({ ...profiles[0]!, formFactor }),
      });
      const el = await mount(api);
      await profileAction(el, "edit-p1");
      await flush(el);
      const tabs = el.shadowRoot!.querySelector("wt-tabs");
      expect(tabs).not.toBeNull();
      expect(tabs!.items.map((item) => item.key)).toEqual(
        formFactor === "till"
          ? ["general", "where", "who", "capabilities", "equipment"]
          : ["general", "kitchen", "who", "capabilities"],
      );
      expect(tabs!.value).toBe("general");
      const name = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        "[data-test=profile-name]",
      )!;
      change(el, "profile-name", "Draft counter");
      const placements =
        formFactor === "till"
          ? [
              ["profile-starting-screen", "general"],
              ["profile-department", "where"],
              ["profile-roles", "who"],
              ["profile-actions", "capabilities"],
            ]
          : [
              ["profile-kitchen-screens", "kitchen"],
              ["profile-roles", "who"],
              ["profile-actions", "capabilities"],
            ];
      for (const [field, tab] of placements) {
        await selectProfileTab(el, tab!);
        const control = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${field}]`)!;
        expect(control.closest("[slot]")!.getAttribute("slot")).toBe(tab);
        expect(control.checkVisibility()).toBe(true);
      }
      await selectProfileTab(el, formFactor === "till" ? "equipment" : "capabilities");
      expect(name.checkVisibility()).toBe(false);
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.closest("wt-tabs")).toBeNull();
      await selectProfileTab(el, "general");
      expect(el.shadowRoot!.querySelector("[data-test=profile-name]")).toBe(name);
      expect(name.value).toBe("Draft counter");
      change(el, "profile-name", profiles[0]!.name);
      await flush(el);
      await selectProfileTab(el, formFactor === "till" ? "equipment" : "capabilities");
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
      await flush(el);
      await profileAction(el, "edit-p1");
      await flush(el);
      expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("general");
    },
  );

  it.each([
    [
      "where",
      {
        code: "device_profile.access_invalid",
        params: { field: "departmentId", reason: "not_found" },
      },
    ],
    ["general", { code: "device_profile.invalid", params: { reason: "bad_starting_screen" } }],
  ] as const)(
    "drops a %s tab's stale error when switching to a kind without that field",
    async (tab, refusal) => {
      const el = await mount(
        stubApi({
          updateDeviceProfile: vi.fn().mockRejectedValue(refusal),
        }),
      );
      await profileAction(el, "edit-p1");
      await flush(el);
      rename(el);
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
      const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
      await vi.waitFor(() => expect(tabs.value).toBe(tab));
      await vi.waitFor(() => expect(tabs.items.some((item) => item.marked)).toBe(true));
      expect(tabs.items.some((item) => item.marked)).toBe(true);
      await selectProfileTab(el, "general");
      await chooseOption(el.shadowRoot!.querySelector("[data-test=profile-form-factor]")!, "kds");
      await flush(el);
      expect(tabs.items.some((item) => item.marked)).toBe(false);
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    },
  );

  it.each([
    ["departmentId", "profile-department", "where"],
    ["admittedStaffRoleIds", "profile-roles", "who"],
    ["capabilities", "profile-actions", "capabilities"],
  ])(
    "opens and marks the tab for a refused %s, then clears its mark after repair",
    async (field, target, tab) => {
      const el = await mount(
        stubApi({
          updateDeviceProfile: vi.fn().mockRejectedValue({
            code: "management.request_invalid",
            params: { field },
          }),
        }),
      );
      await profileAction(el, "edit-p1");
      await flush(el);
      rename(el);
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
      const tabs = el.shadowRoot!.querySelector("wt-tabs");
      await vi.waitFor(() => expect(tabs?.value).toBe(tab));
      expect(tabs!.items.filter((item) => item.marked).map((item) => item.key)).toEqual([tab]);
      expect(tabs!.items.find((item) => item.key === tab)!.marked).toBe(t("form.fix_fields"));
      const control = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${target}]`)!;
      expect(control.checkVisibility()).toBe(true);
      expect(
        el.shadowRoot!.activeElement === control || control.contains(el.shadowRoot!.activeElement),
      ).toBe(true);
      (control.querySelector("wt-switch") ?? control).dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "d1", checked: true },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(tabs!.items.some((item) => item.marked)).toBe(false);
    },
  );
});

describe("device-profiles-screen list mode", () => {
  const capableProfile: DeviceProfile = {
    ...profiles[0]!,
    capabilities: ["integrated-card-payment", "open-cash-drawer", "clock-in", "take-cash"],
  };

  it("shows searchable profile rows with named scope and a short capability summary", async () => {
    const before = currentLocale();
    onTestFinished(() => setLocale(before));
    setLocale("en-GB");
    const terrace = { ...profiles[0]!, id: "p3", name: "Terrace phone", allowedZoneIds: ["z2"] };
    let finishNames!: (choices: ProfileScopeChoices) => void;
    const el = await mount(
      stubApi({
        listDeviceProfiles: vi.fn().mockResolvedValue([capableProfile, profiles[1], terrace]),
        background: {
          getProfileScopeChoices: () =>
            new Promise<ProfileScopeChoices>((resolve) => {
              finishNames = resolve;
            }),
        } as DashboardApi,
      }),
    );
    const table = el.shadowRoot!.querySelector("wt-data-table");
    expect(table).not.toBeNull();
    await table!.updateComplete;
    expect(table!.columns.map(({ label }) => label)).toEqual([
      "Name",
      "Form factor",
      "Where it serves",
      "Capabilities",
      "Actions",
    ]);
    expect(table!.searchable).toBe(true);
    const root = table!.shadowRoot!;
    expect(root.querySelector('[data-test="profile-scope-p1"]')!.textContent).toBe("Loading…");
    finishNames(scopeChoices);
    await flush(el);
    expect(root.querySelector('[data-test="profile-scope-p1"]')!.textContent).toContain(
      "Restaurant",
    );
    expect(root.querySelector('[data-test="profile-scope-p1"]')!.textContent).toContain(
      "All zones",
    );
    expect(root.querySelector('[data-test="profile-scope-p3"]')!.textContent).toContain("Terrace");
    expect(root.querySelector('[data-test="profile-scope-p3"]')!.textContent).not.toContain(
      "Dining room",
    );
    expect(root.querySelector('[data-test="profile-scope-p2"]')!.textContent).toContain(
      "Station screens",
    );
    const summary = root.querySelector('[data-test="profile-caps-p1"]')!.textContent!;
    expect(summary).toContain("Integrated card payment");
    expect(summary).toContain("Open cash drawer");
    expect(summary).toContain("+2 more");
    expect(summary).not.toContain("Clock in");
    expect(table!.columns.find(({ key }) => key === "actions")!.pinned).toBe("end");
  });

  it("finds capabilities hidden by the short summary and the profile's form factor", async () => {
    const before = currentLocale();
    onTestFinished(() => setLocale(before));
    setLocale("en-GB");
    const el = await mount(
      stubApi({ listDeviceProfiles: vi.fn().mockResolvedValue([capableProfile, profiles[1]]) }),
    );
    const table = el.shadowRoot!.querySelector("wt-data-table");
    expect(table).not.toBeNull();
    await userEvent.fill(
      table!.shadowRoot!.querySelector<HTMLInputElement>('input[name="search"]')!,
      "Clock in",
    );
    await table!.updateComplete;
    const keys = () =>
      [...table!.shadowRoot!.querySelectorAll<HTMLElement>("tbody tr[data-row-key]")].map(
        (row) => row.dataset.rowKey,
      );
    expect(keys()).toEqual(["p1"]);
    await userEvent.fill(
      table!.shadowRoot!.querySelector<HTMLInputElement>('input[name="search"]')!,
      "Prep station display",
    );
    await table!.updateComplete;
    expect(keys()).toEqual(["p2"]);
  });

  it("reads scope names passively and keeps the profile table usable if those names fail", async () => {
    const names = vi.fn().mockRejectedValue({ code: "server.internal" });
    const foreground = vi.fn().mockResolvedValue(scopeChoices);
    const background = stubApi({ getProfileScopeChoices: names });
    const el = await mount(stubApi({ background, getProfileScopeChoices: foreground }));
    const table = el.shadowRoot!.querySelector("wt-data-table");
    expect(table).not.toBeNull();
    await table!.updateComplete;
    expect(names).toHaveBeenCalledTimes(1);
    expect(foreground).not.toHaveBeenCalled();
    expect(table!.rows).toHaveLength(2);
    const scope = table!.shadowRoot!.querySelector('[data-test="profile-scope-p1"]')!.textContent!;
    expect(scope).not.toContain("Restaurant");
    expect(scope).not.toContain("Dining room");
    expect(scope).toBe(t("device_profiles.scope_unavailable"));
    expect(inScreenOrRow(el, '[role="alert"]')).not.toBeNull();
    await profileAction(el, "edit-p1");
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-test="editor-form"]')).not.toBeNull();
    expect(inScreenOrRow(el, '[role="alert"]')).toBeNull();
    let finishNames!: (value: ProfileScopeChoices) => void;
    names.mockImplementation(
      () =>
        new Promise<ProfileScopeChoices>((resolve) => {
          finishNames = resolve;
        }),
    );
    const host = el.parentElement!;
    el.remove();
    host.append(el);
    await flush(el);
    expect(inScreenOrRow(el, '[role="alert"]')).toBeNull();
    expect(profileListRoot(el).querySelector('[data-test="profile-scope-p1"]')!.textContent).toBe(
      t("device_profiles.scope_loading"),
    );
    finishNames(scopeChoices);
    await flush(el);
    expect(
      profileListRoot(el).querySelector('[data-test="profile-scope-p1"]')!.textContent,
    ).toContain("Restaurant");
  });

  it.each([
    [{ departmentId: "absent" }, "Department unavailable"],
    [{ allowedZoneIds: ["z4"] }, "Restaurant · Old bar (Deleted)"],
    [{ allowedZoneIds: [] }, "Restaurant · No zones"],
  ])("shows the saved serving scope as %s", async (scope, label) => {
    const before = currentLocale();
    onTestFinished(() => setLocale(before));
    setLocale("en-GB");
    const el = await mount(
      stubApi({ listDeviceProfiles: vi.fn().mockResolvedValue([{ ...profiles[0]!, ...scope }]) }),
    );
    expect(profileListRoot(el).querySelector('[data-test="profile-scope-p1"]')!.textContent).toBe(
      label,
    );
  });

  it("uses fresh editor scope choices instead of the list's cached snapshot", async () => {
    const choices = {
      departments: [{ id: "d2", name: "Deli", active: true }],
      zones: [{ id: "dz", name: "Counter", departmentId: "d2", active: true }],
    };
    const api = Object.assign(
      stubApi({
        getProfileScopeChoices: vi.fn().mockResolvedValue(choices),
        getDeviceProfile: vi
          .fn()
          .mockResolvedValue({ ...profiles[0]!, departmentId: "d2", startingZoneId: "dz" }),
      }),
      { liveData: new LiveData() },
    );
    const el = await mount(api);
    await profileAction(el, "edit-p1");
    await flush(el);
    const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      '[data-test="profile-department"]',
    )!;
    expect(field.options.map(({ value }) => value)).toEqual(["d2"]);
    expect(field.value).toBe("d2");
  });

  it("opens the profile from its row", async () => {
    const el = await mount();
    const row = profileListRoot(el).querySelector<HTMLElement>('[data-row-key="p1"] .row-activate');
    expect(row).not.toBeNull();
    await userEvent.click(row!, { position: { x: 12, y: 12 } });
    await flush(el);
    expect(
      el.shadowRoot!.querySelector('[data-test="editor-form"]')!.getAttribute("data-editing-id"),
    ).toBe("p1");
  });

  it("cancelled deletion restores the row menu without opening the editor", async () => {
    const api = stubApi();
    const el = await mount(api);
    await profileAction(el, "delete-p1");
    const menu = profileListRoot(el)
      .querySelector('[data-test="delete-p1"]')!
      .closest("wt-row-actions")!;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    const cancel = el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel-delete"]');
    expect(cancel).not.toBeNull();
    const closed = new Promise((resolve) =>
      dialog.addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.click(cancel!);
    await closed;
    expect(menu.shadowRoot!.activeElement).toBe(menu.shadowRoot!.querySelector("button"));
    expect(el.shadowRoot!.querySelector('[data-test="editor-form"]')).toBeNull();
    expect(api.deleteDeviceProfile).not.toHaveBeenCalled();
  });

  it("confirmed deletion focuses Create after the profile row disappears", async () => {
    const api = stubApi({
      listDeviceProfiles: vi.fn().mockResolvedValueOnce(profiles).mockResolvedValue([profiles[1]]),
    });
    const el = await mount(api);
    await profileAction(el, "delete-p1");
    await userEvent.click(
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="confirm-delete"]')!,
    );
    await vi.waitFor(() =>
      expect(profileListRoot(el).querySelector('[data-row-key="p1"]')).toBeNull(),
    );
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector('[data-test="create"]'));
  });

  it("loads and lists device profiles with their capability summary", async () => {
    const api = stubApi();
    const el = await mount(api);
    expect(api.listDeviceProfiles).toHaveBeenCalledTimes(1);
    expect(profileListRoot(el).querySelector("[data-test=profile-name-p1]")!.textContent).toContain(
      "Front counter",
    );
    // Two capabilities are summarised on the row (shipped locale is es-ES).
    const caps = profileListRoot(el).querySelector("[data-test=profile-caps-p1]")!.textContent!;
    expect(caps).toContain("tarjeta");
    expect(profileListRoot(el).querySelector('[data-row-key="p2"]')).toBeTruthy();
  });

  it("shows a placeholder when there are no profiles", async () => {
    const el = await mount(stubApi({ listDeviceProfiles: vi.fn().mockResolvedValue([]) }));
    expect(profileListRoot(el).querySelector(".empty")!.textContent!.trim()).toBe(
      t("device_profiles.empty"),
    );
  });

  it("shows the load error in a banner", async () => {
    const el = await mount(
      stubApi({ listDeviceProfiles: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
    );
    expect(inScreenOrRow(el, "[role=alert]")).toBeTruthy();
  });

  it("clears a failed refresh's message once the server answers again", async () => {
    const api = Object.assign(stubApi(), { liveData: new LiveData() });
    const el = await mount(api);
    const alert = () => inScreenOrRow(el, "[role=alert]");
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
    expect(profileListRoot(el).querySelector('[data-row-key="p3"]')).toBeTruthy();
  });

  it("Delete confirms then calls deleteDeviceProfile and reloads", async () => {
    const api = stubApi();
    const el = await mount(api);
    await profileAction(el, "delete-p1");
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
    await profileAction(el, "delete-p1");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await flush(el);
    expect(inScreenOrRow(el, "[role=alert]")).toBeTruthy();
  });

  it("Duplicate creates a copy from the same capabilities under a '(copy)' name", async () => {
    const api = stubApi();
    const el = await mount(api);
    await profileAction(el, "duplicate-p1");
    await flush(el);
    // The shipped locale is es-ES, so the copy suffix is the Spanish " (copia)". The copy carries the
    // source profile's form factor unchanged.
    expect(api.copyDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Front counter (copia)",

      ["integrated-card-payment", "open-cash-drawer"],
      "till",
      null,
      NO_PRINTERS,
      { ...ORDERING, admittedStaffRoleIds: ["job-waiter", "job-chef"] },
    );
    expect(api.listDeviceProfiles).toHaveBeenCalledTimes(2);
  });
});

describe("device-profiles-screen editor form", () => {
  it("Add profile opens a blank editor form (no id) and Save creates via createDeviceProfile", async () => {
    const api = stubApi();
    const el = await mount(api);
    const add = el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!;
    expect(add.textContent!.trim()).toBe("Añadir perfil");
    add.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("[data-test=editor-form]")!;
    expect(form).toBeTruthy();
    expect(form.getAttribute("data-editing-id")).toBeNull();
    change(el, "profile-name", "Kitchen tablet");
    await el.updateComplete;
    await el.updateComplete;
    selectFormFactor(el, "tablet-landscape");
    await el.updateComplete;
    toggle(el, "cap-act-as-kds", true);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.createDeviceProfile).toHaveBeenCalledWith(
      "Kitchen tablet",

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

      ["take-cash"],
      "phone-portrait",
      null,
      NO_PRINTERS,
      ORDERING,
    );
  });

  it("Add profile defaults the form factor to the cash register (till) when unchanged", async () => {
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
      "Pantalla de estación",
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
    expect(inScreenOrRow(el, "[role=alert]")).toBeTruthy();
  });

  it("Edit loads the profile via getDeviceProfile; the capability switches reflect its flags", async () => {
    const api = stubApi();
    const el = await mount(api);
    await profileAction(el, "edit-p1");
    await flush(el);
    expect(api.getDeviceProfile).toHaveBeenCalledWith("p1");
    const form = el.shadowRoot!.querySelector("[data-test=editor-form]")!;
    expect(form.getAttribute("data-editing-id")).toBe("p1");
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
    await profileAction(el, "edit-p1");
    await flush(el);
    const formFactor = el.shadowRoot!.querySelector<Combobox>("[data-test=profile-form-factor]")!;
    expect(formFactor.value).toBe("kds");
    rename(el, "Kitchen counter");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Kitchen counter",

      [],
      "kds",
      null,
      NO_PRINTERS,
    );
  });

  it("Edit → toggling a capability off then Save calls updateDeviceProfile without it", async () => {
    const api = stubApi();
    const el = await mount(api);
    await profileAction(el, "edit-p1");
    await flush(el);
    toggle(el, "cap-integrated-card-payment", false);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Front counter",

      ["open-cash-drawer"],
      "till",
      null,
      NO_PRINTERS,
    );
  });

  it("a non-KDS draft renders the inactivity-timeout input; 5 minutes saves 300 seconds (trailing arg)", async () => {
    const phone: DeviceProfile = { ...profiles[0], formFactor: "phone-portrait" };
    const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(phone) });
    const el = await mount(api);
    await profileAction(el, "edit-p1");
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

      ["integrated-card-payment", "open-cash-drawer"],
      "phone-portrait",
      300,
      NO_PRINTERS,
    );
  });

  it.each([
    [null, "30", 1_800],
    [1_800, "", null],
  ])(
    "saves kitchen idle sign-out from %s seconds to %s minutes",
    async (stored, minutes, seconds) => {
      const kdsProfile: DeviceProfile = {
        ...profiles[0],
        formFactor: "kds",
        inactivityTimeoutSeconds: stored,
      };
      const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(kdsProfile) });
      const el = await mount(api);
      await profileAction(el, "edit-p1");
      await flush(el);

      const input = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
        "[data-test=profile-inactivity]",
      );
      expect(input?.value).toBe(stored === null ? "" : "30");
      change(el, "profile-inactivity", minutes);
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
      await flush(el);

      expect(api.updateDeviceProfile).toHaveBeenCalledWith(
        "p1",
        "Front counter",
        [],
        "kds",
        seconds,
        NO_PRINTERS,
      );
    },
  );

  it("Edit seeds the inactivity-timeout input in minutes from the stored seconds (300 → 5)", async () => {
    const phone: DeviceProfile = {
      ...profiles[0],
      formFactor: "phone-portrait",
      inactivityTimeoutSeconds: 300,
    };
    const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(phone) });
    const el = await mount(api);
    await profileAction(el, "edit-p1");
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
    await profileAction(el, "edit-p1");
    await flush(el);
    expect(inScreenOrRow(el, "[role=alert]")).toBeTruthy();
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
    expect(profileListRoot(el).querySelector('[data-row-key="p1"]')).toBeTruthy();
  });

  it("Cancel discards the form and returns to the list", async () => {
    const api = stubApi();
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
    expect(profileListRoot(el).querySelector('[data-row-key="p1"]')).toBeTruthy();
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
    expect(inScreenOrRow(el, "[role=alert]")).toBeTruthy();
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
    if (action === "create")
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    else await profileAction(el, action);
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
    expect(inScreenOrRow(el, "[role=alert]")).not.toBeNull();
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
    await profileAction(el, "edit-p1");
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
    await profileAction(el, "edit-p1");
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
    await profileAction(el, "delete-p1");
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

  it("picks the form factor from a labelled dropdown showing the profile's own", async () => {
    const api = stubApi();
    const el = await mount(api);
    await profileAction(el, "edit-p1");
    await flush(el);

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

    await chooseOption(formFactor, "tablet-landscape");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledWith(
      "p1",
      "Front counter",

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
    await profileAction(el, "edit-p1");
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
      stubApi({ copyDeviceProfile: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData: new LiveData() },
    );
    const el = await mount(api);
    const alert = () => inScreenOrRow(el, "[role=alert]")?.textContent?.trim();
    vi.mocked(api.listDeviceProfiles).mockRejectedValue({ code: "connection.failed" });
    api.liveData.refresh();
    await vi.waitFor(() => expect(alert()).toBe(codeMessage("connection.failed")));
    await profileAction(el, "duplicate-p1");
    await vi.waitFor(() => expect(api.copyDeviceProfile).toHaveBeenCalledOnce());
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
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p1");
    await vi.waitFor(() =>
      expect(profileListRoot(el).querySelector('[data-row-key="p3"]')).toBeTruthy(),
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
      paperWidth: "80mm",
      resolution: "180dpi",
      hasCashDrawer: false,
      portable: false,
      pickupRoles: ["receipt", "payment_slip"],
      holder: null,
      pendingJobs: 0,
      lastPrintAt: null,
      lastPrintAgentId: null,
      active,
    };
  }

  const venuePrinters = [
    printer("pr1", "Bar"),
    printer("pr2", "Kitchen"),
    printer("pr3", "Terrace"),
    printer("pr4", "Old", false),
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
    await profileAction(el, "edit-p1");
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
    return vi.mocked(api.updateDeviceProfile).mock.calls[0]![5];
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
      "Kitchen",
      "Bar",
      "Terrace",
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
      `${t("device_profiles.move_up")} Bar`,
    );
    expect(button("receipt-printers-down-pr2")!.getAttribute("aria-label")).toBe(
      `${t("device_profiles.move_down")} Kitchen`,
    );
  });

  it("keeps a switched-off printer a list still holds, and offers none it does not", async () => {
    const withOld: DeviceProfile = { ...listedProfile, paymentSlipPrinterIds: ["pr4", "pr3"] };
    const { api, el } = await editListed({
      getDeviceProfile: vi.fn().mockResolvedValue(withOld),
    });
    const slip = switches(el, "payment-slip-printers");
    expect(slip.map((s) => s.dataset.printerId)).toEqual(["pr4", "pr3", "pr1", "pr2"]);
    expect(slip[0]!.label).toBe("Old (Deshabilitada)");
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

  it("swaps a moved printer past an undelivered one and shows its place when it arrives", async () => {
    const liveData = new LiveData();
    const { api, el } = await editListed({
      liveData,
      getDeviceProfile: vi.fn().mockResolvedValue({
        ...listedProfile,
        receiptPrinterIds: ["pr2", "pr-new", "pr1"],
      }),
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=receipt-printers-up-pr1]")!.click();
    await el.updateComplete;
    expect(switchedOn(el, "receipt-printers")).toEqual(["pr1", "pr2"]);
    vi.mocked(api.listPrinters).mockResolvedValue([
      ...venuePrinters,
      printer("pr-new", "Restored"),
    ]);
    liveData.invalidate([{ type: "printers", id: "pr-new" }]);
    await expect.poll(() => switchedOn(el, "receipt-printers")).toContain("pr-new");
    expect(switchedOn(el, "receipt-printers")).toEqual(["pr1", "pr-new", "pr2"]);
    await save(el);
    expect(savedLists(api)).toEqual({
      receiptPrinterIds: ["pr1", "pr-new", "pr2"],
      paymentSlipPrinterIds: ["pr3"],
    });
  });

  it("says to add a printer first when the venue has none", async () => {
    const api = stubApi();
    const el = await mount(api);
    await profileAction(el, "edit-p1");
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
    change(el, "profile-name", "Register");
    toggle(el, "receipt-printers-pr2", true);
    toggle(el, "payment-slip-printers-pr1", true);
    await el.updateComplete;
    await save(el);
    expect(api.createDeviceProfile).toHaveBeenCalledWith(
      "Register",

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
    await profileAction(el, "duplicate-p1");
    await flush(el);
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p1");
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![5]).toEqual({
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

describe("device-profiles-screen kitchen screens", () => {
  const station = (id: string, name: string, active = true): Station => ({
    id,
    name,
    isDefault: false,
    active,
    showsRestOfOrder: false,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  });
  const venueStations = [
    station("s1", "Grill"),
    station("s2", "Cold"),
    station("s3", "Pastry"),
    station("s-off", "Old grill", false),
  ];
  const kitchen = profiles[1]!;
  const till: DeviceProfile = { ...profiles[0]!, capabilities: ["show-station", "show-expo"] };
  /** A station screen on two stations, one switched off since, and a pass monitor on every
   * station but two zones, one switched off since. */
  const stored: ProfileKitchenScreens = {
    station: { stationIds: ["s1", "s-off"], zoneIds: null },
  };
  const monitorStored: ProfileKitchenScreens = {
    pass_monitor: { stationIds: null, zoneIds: ["z2", "z4"] },
  };

  async function edit(
    profile: DeviceProfile,
    screens: ProfileKitchenScreens,
    overrides: Partial<DashboardApi> = {},
  ) {
    const api = stubApi({
      listDeviceProfiles: vi.fn().mockResolvedValue([profiles[0], kitchen]),
      getDeviceProfile: vi.fn().mockResolvedValue(profile),
      listStations: vi.fn().mockResolvedValue(venueStations),
      listProfileKitchenScreens: vi.fn().mockResolvedValue([{ profileId: profile.id, screens }]),
      ...overrides,
    });
    const el = await mount(api);
    await profileAction(el, `edit-${profile.id}`);
    await flush(el);
    return { api, el };
  }

  type Switch = HTMLElement & { checked: boolean; label: string };
  const sw = (el: DeviceProfilesScreen, testId: string) =>
    el.shadowRoot!.querySelector<Switch>(`[data-test="${testId}"]`);
  const shown = (el: DeviceProfilesScreen, group: string) => [
    ...[...el.shadowRoot!.querySelectorAll<Switch>(`[data-test="${group}"] wt-switch`)].map((s) => [
      s.label,
      s.checked,
    ]),
  ];
  const text = (el: DeviceProfilesScreen, testId: string) =>
    el
      .shadowRoot!.querySelector(`[data-test="${testId}"]`)
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ?? null;

  async function save(el: DeviceProfilesScreen) {
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
  }

  it.each([kitchen, till, { ...till, formFactor: "phone-portrait" as const }])(
    "selects one screen on a $formFactor profile and replaces the previous kind",
    async (profile) => {
      const { api, el } = await edit(profile, {
        station: { stationIds: ["s1"], zoneIds: null },
      });
      const choice = el.shadowRoot!.querySelector("[data-test=profile-kitchen-screens]");
      expect(choice?.tagName).toBe("WT-COMBOBOX");
      await chooseOption(choice!, "pass");
      await flush(el);
      expect(sw(el, "profile-station-screen-every-station")).toBeNull();
      expect(sw(el, "profile-pass-screen-every-station")!.checked).toBe(true);
      await save(el);
      expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![6]).toEqual({
        kitchenScreens: { pass: { stationIds: null, zoneIds: null } },
      });
    },
  );

  it("can leave a profile without a kitchen screen", async () => {
    const { api, el } = await edit(kitchen, {
      station: { stationIds: ["s1"], zoneIds: null },
    });
    const choice = el.shadowRoot!.querySelector("[data-test=profile-kitchen-screens]");
    expect(choice?.tagName).toBe("WT-COMBOBOX");
    await chooseOption(choice!, "");
    await flush(el);
    expect(sw(el, "profile-station-screen-every-station")).toBeNull();
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![6]).toEqual({ kitchenScreens: {} });
  });

  it("shows the chosen screen's live stations without deleted choices", async () => {
    const { el } = await edit(kitchen, stored);
    expect(shown(el, "profile-station-screen-stations")).toEqual([
      [t("device_profiles.every_station"), false],
      ["Grill", true],
      ["Cold", false],
      ["Pastry", false],
    ]);
    expect(sw(el, "profile-station-screen-every-zone")).toBeNull();
    expect(sw(el, "profile-pass-screen-every-station")).toBeNull();
    expect(sw(el, "profile-pass-monitor-every-station")).toBeNull();
  });

  it("leaves a till with no configured screen unconfigured", async () => {
    const { el } = await edit(till, {});
    expect(shown(el, "profile-station-screen-stations")).toEqual([]);
    expect(shown(el, "profile-pass-screen-stations")).toEqual([]);
    expect(sw(el, "profile-pass-monitor-every-station")).toBeNull();
  });

  it("draws the display policy only for the selected Pass kind, defaulting to shown", async () => {
    const { el } = await edit(kitchen, {});
    for (const [kind, slug] of [
      ["pass", "pass-screen"],
      ["pass_monitor", "pass-monitor"],
    ]) {
      change(el, "profile-kitchen-screens", kind!);
      await flush(el);
      const control = sw(el, `profile-${slug}-other-stations`)!;
      expect(control.label).toBe(t("device_profiles.show_other_stations"));
      expect(control.checked).toBe(true);
      expect(control.getAttribute("name")).toBe("showNonPassStations");
    }
    change(el, "profile-kitchen-screens", "station");
    await flush(el);
    expect(sw(el, "profile-pass-screen-other-stations")).toBeNull();
    expect(sw(el, "profile-pass-monitor-other-stations")).toBeNull();
  });

  it("shows a stored Hide as off, and sends the switch back on inside that kind's entry", async () => {
    const { api, el } = await edit(kitchen, {
      pass_monitor: { stationIds: null, zoneIds: ["z2", "z4"], showNonPassStations: false },
    });
    expect(sw(el, "profile-pass-monitor-other-stations")!.checked).toBe(false);
    toggle(el, "profile-pass-monitor-other-stations", true);
    await flush(el);
    expect(sw(el, "profile-pass-monitor-other-stations")!.checked).toBe(true);
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![6]).toEqual({
      kitchenScreens: {
        pass_monitor: { stationIds: null, zoneIds: ["z2", "z4"], showNonPassStations: true },
      },
    });
  });

  it("draws the switch under a till's Pass list and sends it switched off", async () => {
    const { api, el } = await edit(till, { pass: { stationIds: null, zoneIds: null } });
    toggle(el, "profile-pass-screen-other-stations", false);
    await flush(el);
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![6]).toEqual({
      kitchenScreens: {
        pass: { stationIds: null, zoneIds: null, showNonPassStations: false },
      },
    });
  });

  it("shows a refusal of the kitchen screens' request as the form's request line, not beside the switch", async () => {
    const { el } = await edit(kitchen, monitorStored, {
      updateDeviceProfile: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "kitchenScreens" },
      }),
    });
    toggle(el, "profile-pass-monitor-other-stations", false);
    await flush(el);
    await save(el);
    expect(el.shadowRoot!.querySelector("[data-test=profile-kitchen-screens-error]")).toBeNull();
    expect(el.shadowRoot!.querySelector(".field-error")).toBeNull();
    expect(inScreenOrRow(el, ".form-message")?.textContent?.trim()).toBe(
      codeMessage("management.request_invalid"),
    );
  });

  it.each([
    ["en", "Show other stations' dishes on the pass"],
    ["es", "Mostrar en el pase los platos de otras estaciones"],
  ] as const)("labels the switch in %s", async (locale, label) => {
    const previous = currentLocale();
    setLocale(locale);
    try {
      const { el } = await edit(kitchen, monitorStored);
      expect(sw(el, "profile-pass-monitor-other-stations")!.label).toBe(label);
    } finally {
      setLocale(previous);
    }
  });

  it("keeps an unconfigured screen empty when another capability changes", async () => {
    const { el } = await edit({ ...till, capabilities: [] }, {});
    toggle(el, "cap-show-expo", true);
    await flush(el);
    expect(sw(el, "profile-station-screen-every-station")).toBeNull();
    expect(sw(el, "profile-pass-screen-every-station")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=profile-kitchen-screens]")).not.toBeNull();
  });

  it("saves a till's pass monitor on one zone", async () => {
    const { api, el } = await edit(till, {});
    change(el, "profile-kitchen-screens", "pass_monitor");
    await flush(el);
    expect(shown(el, "profile-pass-monitor-zones")).toEqual([
      [t("device_profiles.every_zone_venue"), true],
    ]);
    toggle(el, "profile-pass-monitor-every-zone", false);
    await flush(el);
    expect(shown(el, "profile-pass-monitor-zones")).toEqual([
      [t("device_profiles.every_zone_venue"), false],
      ["Dining room", true],
      ["Terrace", true],
    ]);
    toggle(el, "profile-pass-monitor-zone-z1", false);
    await flush(el);
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![6]).toEqual({
      kitchenScreens: { pass_monitor: { stationIds: null, zoneIds: ["z2"] } },
    });
  });

  it("saves a kitchen display's changed lists whole, excluding deleted stations and keeping disabled zones", async () => {
    const { api, el } = await edit(kitchen, stored);
    toggle(el, "profile-station-screen-station-s2", true);
    await flush(el);
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![6]).toEqual({
      kitchenScreens: {
        station: { stationIds: ["s1", "s2"], zoneIds: null },
      },
    });
  });

  it("switching Every zone and Every station back on sends every one again", async () => {
    const { api, el } = await edit(kitchen, {
      pass_monitor: { stationIds: ["s1"], zoneIds: ["z2", "z4"] },
    });
    toggle(el, "profile-pass-monitor-every-zone", true);
    toggle(el, "profile-pass-monitor-every-station", true);
    await flush(el);
    expect(sw(el, "profile-pass-monitor-zone-z2")).toBeNull();
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![6]).toEqual({
      kitchenScreens: {
        pass_monitor: { stationIds: null, zoneIds: null },
      },
    });
  });

  it("switching a kind off drops it from what is sent", async () => {
    const { api, el } = await edit(kitchen, stored);
    change(el, "profile-kitchen-screens", "");
    await flush(el);
    expect(sw(el, "profile-station-screen-every-station")).toBeNull();
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![6]).toEqual({
      kitchenScreens: {},
    });
  });

  it("sends no kitchen screens when they are unchanged", async () => {
    const { api, el } = await edit(kitchen, stored);
    rename(el);
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]).toHaveLength(6);
  });

  it("opened before the kitchen screens' first live read arrives, still saves from what the profile stores", async () => {
    const { api, el } = await edit(kitchen, stored, {
      listProfileKitchenScreens: vi
        .fn()
        .mockReturnValueOnce(new Promise(() => {}))
        .mockResolvedValue([{ profileId: "p2", screens: stored }]),
    });
    toggle(el, "profile-station-screen-station-s2", true);
    await flush(el);
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![6]).toEqual({
      kitchenScreens: {
        station: { stationIds: ["s1", "s2"], zoneIds: null },
      },
    });
  });

  it("keeps a pass monitor in the draft and in what is sent when the form factor changes", async () => {
    const api = stubApi({ listStations: vi.fn().mockResolvedValue(venueStations) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    change(el, "profile-name", "Pass board");
    selectFormFactor(el, "kds");
    await flush(el);
    change(el, "profile-kitchen-screens", "pass_monitor");
    await flush(el);
    selectFormFactor(el, "till");
    await flush(el);
    expect(sw(el, "profile-pass-monitor")).toBeNull();
    toggle(el, "cap-show-expo", true);
    await flush(el);
    expect(
      (
        el.shadowRoot!.querySelector(
          "[data-test=profile-kitchen-screens]",
        ) as HTMLElementTagNameMap["wt-combobox"]
      ).value,
    ).toBe("pass_monitor");
    toggle(el, "cap-show-expo", false);
    await flush(el);
    await save(el);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![5]).toEqual({
      ...ORDERING,
      kitchenScreens: { pass_monitor: { stationIds: null, zoneIds: null } },
    });
  });

  it("creates a kitchen display with the screens chosen, and a till with none sends none", async () => {
    const api = stubApi({ listStations: vi.fn().mockResolvedValue(venueStations) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    change(el, "profile-name", "Kitchen 2");
    selectFormFactor(el, "kds");
    await flush(el);
    change(el, "profile-kitchen-screens", "station");
    await flush(el);
    toggle(el, "profile-station-screen-every-station", false);
    await flush(el);
    toggle(el, "profile-station-screen-station-s2", false);
    toggle(el, "profile-station-screen-station-s3", false);
    await flush(el);
    await save(el);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![5]).toEqual({
      kitchenScreens: { station: { stationIds: ["s1"], zoneIds: null } },
    });
  });

  it.each(["till", "kds"] as const)(
    "focuses a %s profile's refused station-screen choice in its own tab",
    async (formFactor) => {
      const profile =
        formFactor === "till" ? { ...profiles[0]!, capabilities: ["show-station"] } : kitchen;
      const { el } = await edit(profile, stored, {
        updateDeviceProfile: vi.fn().mockRejectedValue({
          code: "device_profile.access_invalid",
          params: { field: "kitchenScreens", reason: "not_for_screen" },
        }),
      });
      rename(el);
      await save(el);
      const tab = formFactor === "till" ? "capabilities" : "kitchen";
      await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe(tab));
      const group = el.shadowRoot!.querySelector("[data-test=profile-kitchen-screens]")!;
      expect(el.shadowRoot!.activeElement).toBe(group);
    },
  );

  it.each([
    ["passMonitorZones", "empty", "profile-pass-monitor-zones", "device_profiles.err_list_empty"],
    ["stationScreenStations", "not_found", "profile-station-screen-stations", null],
    ["kitchenScreens", "not_for_screen", "profile-kitchen-screens", null],
  ] as const)(
    "puts a %s refusal (%s) under its own list",
    async (field, reason, group, sentence) => {
      const { el } = await edit(
        kitchen,
        field === "passMonitorZones"
          ? { pass_monitor: { stationIds: null, zoneIds: ["z2"] } }
          : stored,
        {
          updateDeviceProfile: vi.fn().mockRejectedValue({
            code: "device_profile.access_invalid",
            params: { field, reason },
          }),
        },
      );
      rename(el);
      await flush(el);
      await save(el);
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("kitchen"),
      );
      expect(
        el.shadowRoot!.querySelector("wt-tabs")!.items.find((item) => item.key === "kitchen")!
          .marked,
      ).toBe(t("form.fix_fields"));
      expect(
        group === "profile-kitchen-screens"
          ? (
              el.shadowRoot!.querySelector(
                "[data-test=profile-kitchen-screens]",
              ) as HTMLElementTagNameMap["wt-combobox"]
            ).error
          : text(el, `${group}-error`),
      ).toBe(sentence === null ? codeMessage("device_profile.access_invalid") : t(sentence));
      expect(inScreenOrRow(el, ".form-message")?.textContent?.trim()).toBe(t("form.fix_fields"));
    },
  );

  it("permanent delete keeps station choices within a phone profile editor with long names", async () => {
    await page.viewport(390, 900);
    try {
      const { el } = await edit(
        kitchen,
        { station: { stationIds: [], zoneIds: null } },
        {
          listStations: vi
            .fn()
            .mockResolvedValue([
              station("s1", "Covered terrace preparation station for the dining room and kitchen"),
            ]),
        },
      );
      const lists = el.shadowRoot!.querySelector<HTMLElement>(
        '[data-test="profile-station-screen-lists"]',
      )!;
      await new Promise(requestAnimationFrame);
      expect(lists.getBoundingClientRect().right).toBeLessThanOrEqual(
        el.getBoundingClientRect().right,
      );
      expect(lists.getBoundingClientRect().left).toBeGreaterThanOrEqual(
        el.getBoundingClientRect().left,
      );
    } finally {
      await page.viewport(1280, 900);
    }
  });

  it.each([
    ["en", "No stations selected. Choose stations or Every."],
    ["es", "No hay estaciones elegidas. Elige estaciones o Todas."],
  ] as const)(
    "permanent delete explains an empty explicit bound briefly in %s",
    async (locale, message) => {
      const before = currentLocale();
      try {
        setLocale(locale);
        const { el } = await edit(kitchen, { station: { stationIds: [], zoneIds: null } });
        expect(
          el
            .shadowRoot!.querySelector('[data-test="empty-station-selection"]')!
            .textContent?.trim(),
        ).toBe(message);
      } finally {
        setLocale(before);
      }
    },
  );

  it("permanent delete displays an explicit empty profile bound and preserves it on an unrelated save", async () => {
    const { api, el } = await edit(kitchen, { station: { stationIds: [], zoneIds: null } });
    const every = sw(el, "profile-station-screen-every-station")!;
    expect(every.shadowRoot!.querySelector<HTMLInputElement>("input")!.checked).toBe(false);
    expect(el.shadowRoot!.querySelector('[data-test="empty-station-selection"]')).not.toBeNull();
    expect(
      el.shadowRoot!.querySelector('[data-test="empty-station-selection"]')!.textContent?.trim(),
    ).toBe(t("devices.empty_station_selection"));
    rename(el);
    await save(el);
    await flush(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]).toEqual([
      "p2",
      "Renamed",

      [],
      "kds",
      null,
      { receiptPrinterIds: [], paymentSlipPrinterIds: [] },
    ]);
  });

  it("permanent delete keeps an empty explicit station bound when a kitchen profile is duplicated", async () => {
    const { api, el } = await edit(kitchen, {
      station: { stationIds: ["s1", "s-off"], zoneIds: null },
      pass: { stationIds: ["s-off"], zoneIds: null },
      pass_monitor: { stationIds: null, zoneIds: ["z4"] },
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await flush(el);
    await profileAction(el, "duplicate-p2");
    await flush(el);
    await flush(el);
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p2");
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![6]).toEqual({
      admittedStaffRoleIds: ["job-waiter", "job-chef"],
      kitchenScreens: {
        station: { stationIds: ["s1"], zoneIds: null },
        pass: { stationIds: [], zoneIds: null },
        pass_monitor: { stationIds: null, zoneIds: [] },
      },
    });
  });

  it("keeps a till's kind whose list is all switched off, emptied, so the server refuses the copy rather than letting it offer every station", async () => {
    const { api, el } = await edit(till, {
      station: { stationIds: ["s-off"], zoneIds: null },
      pass: { stationIds: null, zoneIds: ["z4"] },
      pass_monitor: { stationIds: ["s-off"], zoneIds: null },
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await flush(el);
    await profileAction(el, "duplicate-p1");
    await flush(el);
    await flush(el);
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p1");
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![6]).toMatchObject({
      kitchenScreens: {
        station: { stationIds: [], zoneIds: null },
        pass: { stationIds: null, zoneIds: [] },
      },
    });
    expect(
      vi.mocked(api.copyDeviceProfile).mock.calls[0]![6]!.kitchenScreens!.pass_monitor,
    ).toEqual({ stationIds: [], zoneIds: null });
  });

  it("copies a till's pass monitor when it is duplicated", async () => {
    const { api, el } = await edit(till, {
      pass_monitor: { stationIds: ["s2"], zoneIds: ["z1", "z4"] },
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await flush(el);
    await profileAction(el, "duplicate-p1");
    await flush(el);
    await flush(el);
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p1");
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![6]).toMatchObject({
      kitchenScreens: { pass_monitor: { stationIds: ["s2"], zoneIds: ["z1"] } },
    });
  });
});

describe("device-profiles-screen where a profile serves and who signs in (W97)", () => {
  type Field = HTMLElement & {
    label: string;
    value: string;
    error: string;
    required: boolean;
    checked: boolean;
  };
  const q = (el: DeviceProfilesScreen, testId: string) =>
    el.shadowRoot!.querySelector<Field>(`[data-test="${testId}"]`);
  const text = (el: DeviceProfilesScreen, testId: string) =>
    q(el, testId)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
  const bottom = (el: DeviceProfilesScreen) =>
    inScreenOrRow(el, ".form-message")?.textContent?.trim() ?? null;
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
    change(el, "profile-name", "Patio");
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
    await profileAction(el, `edit-${profile.id}`);
    await flush(el);
    return { api, el };
  }

  const extras = (api: DashboardApi) => vi.mocked(api.updateDeviceProfile).mock.calls[0]![6];

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
    toggle(el, "profile-role-job-waiter", false);
    await save(el);
    expect(api.updateDeviceProfile).not.toHaveBeenCalled();
    expect(text(el, "profile-zones-error")).toBe(t("device_profiles.err_zones_required"));
    expect(q(el, "editor-form")).not.toBeNull();
    toggle(el, "profile-zone-z1", true);
    await flush(el);
    await save(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledOnce();
    expect(extras(api)).toEqual({
      admittedStaffRoleIds: ["job-chef"],
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
    await profileAction(el, "edit-p1");
    await flush(el);
    q(el, "create")!.click();
    await flush(el);
    change(el, "profile-name", "Patio");
    await flush(el);
    arriveLate(profiles[0]!);
    await flush(el);
    expect(q(el, "editor-form")!.hasAttribute("data-editing-id")).toBe(false);
    expect(q(el, "profile-name")!.value).toBe("Patio");
  });

  it("puts department and job names holding a replacement pattern in as written", async () => {
    const el = await openCreate(
      stubApi({
        getProfileScopeChoices: vi.fn().mockResolvedValue({
          ...scopeChoices,
          departments: [{ id: "d1", name: "Restaurant $&", active: true }],
        }),
        listJobRoles: vi
          .fn()
          .mockResolvedValue([{ id: "job-waiter", name: "Waiter $&", holderIds: [] }]),
      }),
    );
    expect(text(el, "profile-zones-hint")).toBe(
      t("device_profiles.every_zone_hint").split("{department}").join("Restaurant $&"),
    );
    expect(q(el, "profile-role-job-waiter")!.label).toBe("Waiter $&");
  });

  it("starts a new profile in the venue's only department, at its first zone, using every zone", async () => {
    const api = stubApi();
    const el = await openCreate(api);
    expect(q(el, "profile-department")!.value).toBe("d1");
    expect(q(el, "profile-department")!.required).toBe(true);
    expect(q(el, "profile-every-zone")!.checked).toBe(true);
    expect(text(el, "profile-zones-hint")).toBe(
      t("device_profiles.every_zone_hint").replace("{department}", "Restaurant"),
    );
    expect(q(el, "profile-starting-zone")!.value).toBe("z1");
    expect(q(el, "profile-starting-zone")!.required).toBe(true);
    expect(options(el, "profile-starting-zone")).toEqual(["z1", "z2"]);
    await save(el);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![5]).toEqual(ORDERING);
  });

  it("asks for a department when the venue has several, beside the field and at the bottom, and sends nothing until one is chosen", async () => {
    const api = stubApi({
      getProfileScopeChoices: vi.fn().mockResolvedValue({
        departments: [...scopeChoices.departments, { id: "d2", name: "Deli", active: true }],
        zones: [
          ...scopeChoices.zones,
          { id: "z3", name: "Counter", departmentId: "d2", active: true },
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
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![5]).toEqual({
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

  it("says a chosen department has no zones and where to add one, and asks for no starting zone", async () => {
    const api = stubApi({
      getProfileScopeChoices: vi.fn().mockResolvedValue({
        departments: [...scopeChoices.departments, { id: "d2", name: "Deli", active: true }],
        zones: scopeChoices.zones,
      }),
    });
    const el = await openCreate(api);
    await chooseOption(q(el, "profile-department")!, "d2");
    await flush(el);
    expect(q(el, "profile-every-zone")!.checked).toBe(true);
    await save(el);
    expect(api.createDeviceProfile).not.toHaveBeenCalled();
    expect(text(el, "profile-zones-error")).toBe(t("device_profiles.err_department_no_zones"));
    expect(q(el, "profile-starting-zone")!.error).toBe("");
    expect(bottom(el)).toBe(t("form.fix_fields"));
  });

  it("offers every zone of the department as the starting zone from the reply the venue sends", async () => {
    const reply = {
      departments: [{ id: "d2", name: "Santet Deli Co", active: true, isDefault: true }],
      zones: ["Counter", "Front Bar", "Main Bar", "Saloon", "Terrace"].map((name, index) => ({
        id: `dz${index}`,
        name,
        departmentId: "d2",
        departmentName: "Santet Deli Co",
        serviceMode: "prepay",
        active: true,
      })),
    };
    const real = new RealDashboardApi(
      "",
      async () =>
        new Response(JSON.stringify(reply), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const api = stubApi({ getProfileScopeChoices: () => real.getProfileScopeChoices() });
    const el = await openCreate(api);
    await vi.waitFor(() => expect(q(el, "profile-every-zone")?.checked).toBe(true));
    expect(options(el, "profile-starting-zone")).toEqual(["dz0", "dz1", "dz2", "dz3", "dz4"]);
    expect(q(el, "profile-starting-zone")!.value).toBe("dz0");
    await save(el);
    expect(vi.mocked(api.createDeviceProfile).mock.calls[0]![5]).toEqual({
      departmentId: "d2",
      allowedZoneIds: null,
      startingZoneId: "dz0",
    });
  });

  it("waits for job choices before creating a profile", async () => {
    let deliver!: (roles: JobRole[]) => void;
    const api = stubApi({
      listJobRoles: vi.fn(
        () =>
          new Promise<JobRole[]>((resolve) => {
            deliver = resolve;
          }),
      ),
    });
    const el = await openCreate(api);
    change(el, "profile-department", "d1");
    await flush(el);
    await save(el);
    expect(api.createDeviceProfile).not.toHaveBeenCalled();
    expect(text(el, "admitted-people")).toBeNull();
    deliver([{ id: "job-waiter", name: "Waiter", holderIds: [] }]);
    await flush(el);
    expect(q(el, "profile-role-job-waiter")!.checked).toBe(true);
    await save(el);
    expect(api.createDeviceProfile).toHaveBeenCalledOnce();
  });

  it("ticks job roles in rota order and shows no people or access levels", async () => {
    const { api, el } = await openEdit(
      { ...profiles[0]!, admittedStaffRoleIds: ["job-waiter"] },
      {
        listJobRoles: vi.fn().mockResolvedValue([
          { id: "job-chef", name: "Chef", colour: "grey", position: 0, holderIds: [] },
          { id: "job-waiter", name: "Waiter", colour: "grey", position: 1, holderIds: [] },
        ]),
      },
    );
    expect(
      [...q(el, "profile-roles")!.querySelectorAll<Field>("wt-switch")].map((s) => s.label),
    ).toEqual(["Chef", "Waiter"]);
    expect(q(el, "profile-role-job-waiter")!.checked).toBe(true);
    expect(q(el, "profile-role-job-chef")!.checked).toBe(false);
    expect(q(el, "profile-people")).toBeNull();
    expect(q(el, "profile-role-admin")).toBeNull();
    toggle(el, "profile-role-job-chef", true);
    await flush(el);
    await save(el);
    expect(extras(api)).toEqual({ admittedStaffRoleIds: ["job-chef", "job-waiter"] });
  });

  it("saves the roles allowed to sign in on a kitchen display", async () => {
    const { api, el } = await openEdit({ ...profiles[1]!, admittedStaffRoleIds: [] });
    expect(el.shadowRoot!.querySelector("wt-tabs")!.items.map(({ key }) => key)).toContain("who");
    await selectProfileTab(el, "who");
    expect(q(el, "profile-role-job-chef")?.checked).toBe(false);
    toggle(el, "profile-role-job-chef", true);
    await flush(el);
    await save(el);
    expect(extras(api)).toEqual({ admittedStaffRoleIds: ["job-chef"] });
  });

  it("an empty job selection saves and says nobody can sign in", async () => {
    const { api, el } = await openEdit(
      { ...profiles[0]!, admittedStaffRoleIds: ["job-waiter"] },
      {
        listJobRoles: vi
          .fn()
          .mockResolvedValue([
            { id: "job-waiter", name: "Waiter", colour: "grey", position: 0, holderIds: [] },
          ]),
      },
    );
    toggle(el, "profile-role-job-waiter", false);
    await flush(el);
    expect(text(el, "admitted-people")).toBe(t("device_profiles.admitted_nobody"));
    await save(el);
    expect(extras(api)).toEqual({ admittedStaffRoleIds: [] });
  });

  it("draws actions and screens as separate groups, and offers a kitchen display taking, preparing and handing over", async () => {
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
      "cap-clock-in",
      "cap-close-deferred",
    ]);
    expect(flags("profile-screens")).toEqual([
      "cap-act-as-kds",
      "cap-show-station",
      "cap-show-expo",
      "cap-show-schedule",
      "cap-run-the-pass",
    ]);
    expect(text(el, "actions-hint")).toBe(t("device_profiles.actions_hint"));
    selectFormFactor(el, "kds");
    await flush(el);
    expect(flags("profile-actions")).toEqual([
      "cap-take-orders",
      "cap-prepare-orders",
      "cap-hand-over-orders",
    ]);
    expect(flags("profile-screens")).toContain("cap-run-the-pass");
    expect(text(el, "actions-hint")).toBe(t("device_profiles.shared_display_actions_hint"));
    expect(q(el, "profile-department")).toBeNull();
    expect(q(el, "profile-roles")).not.toBeNull();
    expect(q(el, "profile-starting-screen")).toBeNull();
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![2]).toEqual([
      "act-as-kds",
      "take-orders",
      "prepare-orders",
    ]);
  });

  it("offers Closes bills as deferred payments as an action, off until switched on, and saves it", async () => {
    const { api, el } = await openEdit({ ...profiles[0]!, capabilities: ["take-orders"] });
    const sw = q(el, "cap-close-deferred") as Field;
    expect(q(el, "profile-actions")!.contains(sw)).toBe(true);
    expect(sw.getAttribute("label")).toBe(t("device_profiles.capability.close-deferred"));
    expect(t("device_profiles.capability.close-deferred")).not.toBe(
      "device_profiles.capability.close-deferred",
    );
    expect(sw.checked).toBe(false);
    toggle(el, "cap-close-deferred", true);
    await flush(el);
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![2]).toEqual([
      "take-orders",
      "close-deferred",
    ]);
  });

  it("labels the Runs the pass switch", async () => {
    const { el } = await openEdit({ ...profiles[0]!, capabilities: ["run-the-pass"] });
    const sw = q(el, "cap-run-the-pass") as Field;
    expect(sw.getAttribute("label")).toBe(t("device_profiles.capability.run-the-pass"));
    expect(t("device_profiles.capability.run-the-pass")).not.toBe(
      "device_profiles.capability.run-the-pass",
    );
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

  it("says every device inherits its profile's chosen screen", async () => {
    const grill: Station = {
      id: "s1",
      name: "Grill",
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
    expect(text(el, "kitchen-screens-hint")).toBe(t("device_profiles.kitchen_screens_hint"));
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
        params: { field: "admittedStaffRoleIds", reason: "not_found", staffRoleId: "gone" },
      },
      "roles",
      "device_profiles.err_roles",
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
    await profileAction(el, "edit-p1");
    await flush(el);
    change(el, "profile-name", "Draft name");
    toggle(el, "profile-role-job-waiter", false);
    await flush(el);
    vi.mocked(api.listJobRoles).mockResolvedValue([
      { id: "job-waiter", name: "Waiter", holderIds: [] },
      { id: "job-chef", name: "Chef", holderIds: [] },
      { id: "job-new", name: "Barista", holderIds: [] },
    ]);
    liveData.invalidate([
      { type: "staff_roles", id: "job-new" },
      { type: "device_profiles", id: "p1" },
    ]);
    await vi.waitFor(() => expect(api.listJobRoles).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(q(el, "profile-name")!.value).toBe("Draft name");
    expect(q(el, "profile-role-job-waiter")!.checked).toBe(false);
    expect(q(el, "profile-role-job-new")!.label).toBe("Barista");
    expect(q(el, "profile-role-job-new")!.checked).toBe(false);
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
    await profileAction(el, "duplicate-p1");
    await flush(el);
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p1");
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![6]).toEqual({
      departmentId: "d1",
      allowedZoneIds: ["z1"],
      startingZoneId: "z1",
      admittedStaffRoleIds: ["job-waiter", "job-chef"],
    });
  });

  it.each([
    [
      "its department is switched off",
      { ...scopeChoices, departments: [{ id: "d1", name: "Restaurant", active: false }] },
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
      await profileAction(el, "duplicate-p1");
      await flush(el);
      expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p1");
      expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![6]).toEqual({
        admittedStaffRoleIds: ["job-waiter", "job-chef"],
      });
    },
  );

  it("reads the departments and zones initially and after live changes while the editor is open", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const el = await mount(api);
    expect(api.getProfileScopeChoices).not.toHaveBeenCalled();
    await profileAction(el, "edit-p1");
    await flush(el);
    expect(api.getProfileScopeChoices).toHaveBeenCalledTimes(1);
    liveData.invalidate([
      { type: "departments", id: "d1" },
      { type: "floor_zones", id: "z1" },
    ]);
    await flush(el);
    expect(api.getProfileScopeChoices).toHaveBeenCalledTimes(3);
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
    await profileAction(el, "edit-p1");
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
    for (const field of ["profile-starting-screen"]) {
      const box = q(el, field) as unknown as Combobox & { showEmptyOption: boolean };
      expect(box.showEmptyOption).toBe(true);
      expect(box.placeholder).toBe("");
    }
  });

  it("describes the every-zone switch by its hint", async () => {
    const { el } = await openEdit(profiles[0]!);
    expect((q(el, "profile-every-zone") as unknown as { description: string }).description).toBe(
      t("device_profiles.every_zone_hint").replace("{department}", "Restaurant"),
    );
  });

  it("copies an empty job selection on a kitchen-display profile", async () => {
    const kitchen = { ...profiles[1]!, admittedStaffRoleIds: [] };
    const api = stubApi({ listDeviceProfiles: vi.fn().mockResolvedValue([kitchen]) });
    const el = await mount(api);
    await profileAction(el, "duplicate-p2");
    await flush(el);
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![6]).toEqual({
      admittedStaffRoleIds: [],
    });
  });

  it("copies where a profile serves, who signs in and its starting screen when it is duplicated", async () => {
    const narrowed: DeviceProfile = {
      ...profiles[0]!,
      capabilities: ["show-schedule"],
      allowedZoneIds: ["z2"],
      startingZoneId: "z2",
      admittedStaffRoleIds: ["job-chef"],
      startingScreen: "show-schedule",
    };
    const api = stubApi({ listDeviceProfiles: vi.fn().mockResolvedValue([narrowed]) });
    const el = await mount(api);
    await profileAction(el, "duplicate-p1");
    await flush(el);
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p1");
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![6]).toEqual({
      departmentId: "d1",
      allowedZoneIds: ["z2"],
      startingZoneId: "z2",
      admittedStaffRoleIds: ["job-chef"],
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
      paperWidth: "80mm",
      resolution: "180dpi",
      hasCashDrawer: false,
      portable: false,
      pickupRoles: ["receipt", "payment_slip"],
      holder: null,
      pendingJobs: 0,
      lastPrintAt: null,
      lastPrintAgentId: null,
      active: true,
      ...extra,
    };
  }

  const venuePrinters = [
    printer("pr1", "Counter", { hasCashDrawer: true }),
    printer("pr2", "Kitchen"),
    printer("pr3", "Terrace"),
  ];

  const readers = [
    {
      printsOwnSlipAutomatically: false,
      id: "r1",
      provider: "acme",
      name: "Front desk",
      active: true,
      canEnable: true,
      deviceCount: 0,
      deviceNames: [],
    },
    {
      printsOwnSlipAutomatically: false,
      id: "r2",
      provider: "acme",
      name: "Patio",
      active: true,
      canEnable: true,
      deviceCount: 0,
      deviceNames: [],
    },
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
    await profileAction(el, "edit-p1");
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
    return vi.mocked(api.updateDeviceProfile).mock.calls[0]![6];
  }

  it("changing an edited printer default to a kitchen profile sends no hidden default", async () => {
    const { api, el } = await editListed();
    await chooseOption(field(el, "receipt-printers-default"), "pr2");
    await chooseOption(field(el, "profile-form-factor"), "kds");
    await save(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledTimes(1);
    expect(savedExtras(api) ?? {}).not.toHaveProperty("receiptPrinterDefaultId");
  });

  it("a kitchen profile offers no payment or receipt equipment and saves empty printer lists", async () => {
    const { api, el } = await editListed(
      {},
      {
        ...listedProfile,
        formFactor: "kds",
        capabilities: ["prepare-orders"],
        startingScreen: null,
      },
    );
    for (const key of [
      "receipt-printers",
      "payment-slip-printers",
      "cash-drawer-printers",
      "invoice-printers",
    ])
      expect(el.shadowRoot!.querySelector(`[data-test=${key}]`)).toBeNull();
    rename(el);
    await save(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![5]).toEqual({
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
    });
    for (const key of [
      "cashDrawerPrinterIds",
      "invoicePrinterIds",
      "receiptPrinterDefaultId",
      "paymentSlipPrinterDefaultId",
      "cashDrawerPrinterDefaultId",
      "invoicePrinterDefaultId",
    ])
      expect(savedExtras(api) ?? {}).not.toHaveProperty(key);
  });

  it("offers each list's own printers as its default, None first, and shows the stored default", async () => {
    const { el } = await editListed();
    const receipt = field(el, "receipt-printers-default");
    expect(receipt.getAttribute("name")).toBe("receiptPrinterDefaultId");
    expect(receipt.value).toBe("pr1");
    expect(receipt.options).toEqual([
      { value: "", label: t("device_profiles.default_none") },
      { value: "pr2", label: "Kitchen" },
      { value: "pr1", label: "Counter" },
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
      ["pr2", `Kitchen (${t("device_profiles.no_drawer_attached")})`, true],
      ["pr1", "Counter", false],
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

  function a4(id: string, name: string, active = true): PagePrinterRow {
    return {
      id,
      name,
      host: "10.0.0.20",
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 300,
      active,
      agentId: "ag1",
      agentName: "Box",
    };
  }
  const offices = [a4("pg1", "Office"), a4("pg2", "Storeroom", false), a4("pg3", "Reception")];

  function equipmentSwitches(el: DeviceProfilesScreen, group: string) {
    return [...el.shadowRoot!.querySelectorAll<HTMLElement>(`[data-test=${group}] wt-switch`)];
  }

  function equipmentState(rows: HTMLElement[]) {
    return rows.map((row) => [row.dataset.test, row.shadowRoot!.querySelector("input")!.checked]);
  }

  it.each([
    ["receipt-printers", "receiptPrinterIds", "pr1", "pr3"],
    ["payment-slip-printers", "paymentSlipPrinterIds", "pr1", "pr3"],
    ["cash-drawer-printers", "cashDrawerPrinterIds", "pr1", "pr3"],
    ["invoice-printers", "invoicePrinterIds", "pr1", "pg1"],
    ["profile-readers", "readerIds", "r1", "r2"],
  ] as const)(
    "switches only the clicked row in %s and saves in display order",
    async (group, key, first, last) => {
      const { el, api } = await editListed(
        {
          listPrinters: async () =>
            venuePrinters.map((printer) => ({ ...printer, hasCashDrawer: true })),
          listPagePrinters: async () => offices,
          getProfileReaders: async () => ({ readerIds: [], defaultReaderId: null }),
        },
        {
          ...listedProfile,
          receiptPrinterIds: [],
          paymentSlipPrinterIds: [],
          receiptPrinterDefaultId: null,
        },
      );
      await selectProfileTab(el, "equipment");
      const rows = equipmentSwitches(el, group);
      const prefix = group === "profile-readers" ? "profile-reader" : group;
      const targetId = `${prefix}-${last}`;
      const target = rows.find((row) => row.dataset.test === targetId)!;
      const control = (row: HTMLElement) => row.shadowRoot!.querySelector("input")!;
      const before = equipmentState(rows);
      await userEvent.click(control(target));
      await flush(el);
      expect({
        state: equipmentState(equipmentSwitches(el, group)),
        focused: el.shadowRoot!.activeElement?.getAttribute("data-test"),
      }).toEqual({
        state: before.map(([id]) => [id, id === targetId]),
        focused: targetId,
      });
      await userEvent.click(target.shadowRoot!.querySelector("label")!);
      await flush(el);
      expect(equipmentState(equipmentSwitches(el, group))).toEqual(before);

      await userEvent.click(control(target));
      await userEvent.click(
        control(rows.find((row) => row.dataset.test === `${prefix}-${first}`)!),
      );
      await save(el);
      const sent =
        key === "readerIds"
          ? vi.mocked(api.setProfileReaders).mock.calls[0]?.[1].readerIds
          : key === "receiptPrinterIds" || key === "paymentSlipPrinterIds"
            ? vi.mocked(api.updateDeviceProfile).mock.calls[0]?.[5]?.[key]
            : savedExtras(api)?.[key];
      expect(sent).toEqual([first, last]);
    },
  );

  it("keeps a moved printer in place when switched off and back on", async () => {
    const { el, api } = await editListed();
    await selectProfileTab(el, "equipment");
    field(el, "receipt-printers-up-pr1").focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    const rowOrder = () => equipmentState(equipmentSwitches(el, "receipt-printers"));
    expect(el.shadowRoot!.activeElement).toBe(field(el, "receipt-printers-down-pr1"));
    const counter = field(el, "receipt-printers-pr1").shadowRoot!.querySelector("label")!;
    await userEvent.click(counter);
    await flush(el);
    expect(rowOrder()).toEqual([
      ["receipt-printers-pr1", false],
      ["receipt-printers-pr2", true],
      ["receipt-printers-pr3", false],
    ]);
    await userEvent.click(counter);
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![5].receiptPrinterIds).toEqual([
      "pr1",
      "pr2",
    ]);
  });

  it("moves printers in the shown order after a live rename", async () => {
    const liveData = new LiveData();
    const { el, api } = await editListed(
      { liveData },
      {
        ...listedProfile,
        receiptPrinterIds: [],
        receiptPrinterDefaultId: null,
      },
    );
    toggle(el, "receipt-printers-pr3", true);
    toggle(el, "receipt-printers-pr1", true);
    await flush(el);
    const shown = () => equipmentState(equipmentSwitches(el, "receipt-printers"));
    const before = shown();
    vi.mocked(api.listPrinters).mockResolvedValue([
      { ...venuePrinters[2]!, name: "Aardvark" },
      ...venuePrinters.slice(0, 2),
    ]);
    liveData.invalidate([{ type: "printers", id: "pr3" }]);
    await expect
      .poll(() => field(el, "receipt-printers-pr3").getAttribute("label"))
      .toBe("Aardvark");
    expect(shown()).toEqual(before);

    field(el, "receipt-printers-up-pr3").click();
    await flush(el);
    expect(
      shown()
        .filter(([, checked]) => checked)
        .map(([id]) => id),
    ).toEqual(["receipt-printers-pr3", "receipt-printers-pr1"]);
    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![5].receiptPrinterIds).toEqual([
      "pr3",
      "pr1",
    ]);
  });

  it("keeps the printer rows in place after a card-reader save fails", async () => {
    const profile = { ...listedProfile, receiptPrinterIds: [], receiptPrinterDefaultId: null };
    const { el, api } = await editListed(
      {
        updateDeviceProfile: vi.fn(async (_id, _name, _actions, _factor, _timeout, lists) => ({
          ...profile,
          ...lists,
        })),
        setProfileReaders: vi.fn().mockRejectedValue({ code: "connection.failed" }),
      },
      profile,
    );
    toggle(el, "receipt-printers-pr3", true);
    toggle(el, "receipt-printers-pr1", true);
    toggle(el, "profile-reader-r2", true);
    await flush(el);
    const shown = () => equipmentState(equipmentSwitches(el, "receipt-printers"));
    const before = shown();

    await save(el);
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![5].receiptPrinterIds).toEqual([
      "pr1",
      "pr3",
    ]);
    expect(shownText(el)).toContain(codeMessage("connection.failed"));
    expect(shown()).toEqual(before);
  });

  describe("the invoice list", () => {
    const invoiceProfile: DeviceProfile = {
      ...listedProfile,
      invoicePrinterIds: ["pg3", "pr2"],
      invoicePrinterDefaultId: "pg3",
    };
    const withOffices = { listPagePrinters: vi.fn().mockResolvedValue(offices) };
    type Switch = HTMLElement & { checked: boolean; label: string };
    const invoiceSwitches = (el: DeviceProfilesScreen) => [
      ...el.shadowRoot!.querySelectorAll<Switch>(
        "[data-test=invoice-printers] wt-switch[data-printer-id]",
      ),
    ];

    it("offers the switched-on receipt and A4 printers, the A4 ones marked, the profile's first", async () => {
      const { el } = await editListed(withOffices, invoiceProfile);
      expect(
        invoiceSwitches(el).map((s) => [
          s.dataset.printerId,
          s.label,
          s.checked,
          s.getAttribute("name"),
        ]),
      ).toEqual([
        ["pg3", "Reception · A4", true, "invoicePrinterIds"],
        ["pr2", "Kitchen", true, "invoicePrinterIds"],
        ["pr1", "Counter", false, "invoicePrinterIds"],
        ["pr3", "Terrace", false, "invoicePrinterIds"],
        ["pg1", "Office · A4", false, "invoicePrinterIds"],
      ]);
      expect(el.shadowRoot!.querySelector("#invoice-printers-heading")?.textContent?.trim()).toBe(
        t("device_profiles.invoice_printers"),
      );
      const fallback = field(el, "invoice-printers-default");
      expect(fallback.getAttribute("name")).toBe("invoicePrinterDefaultId");
      expect(fallback.getAttribute("label")).toBe(t("device_profiles.invoice_default"));
      expect(fallback.value).toBe("pg3");
      expect(fallback.options).toEqual([
        { value: "", label: t("device_profiles.default_none") },
        { value: "pg3", label: "Reception · A4" },
        { value: "pr2", label: "Kitchen" },
      ]);
    });

    it("saves the invoice list and its default", async () => {
      const { api, el } = await editListed(withOffices);
      toggle(el, "invoice-printers-pr3", true);
      toggle(el, "invoice-printers-pg1", true);
      await flush(el);
      await chooseOption(field(el, "invoice-printers-default"), "pg1");
      await flush(el);
      await save(el);
      expect(savedExtras(api)).toMatchObject({
        invoicePrinterIds: ["pr3", "pg1"],
        invoicePrinterDefaultId: "pg1",
      });
    });

    it("sends neither the invoice list nor its default when a save leaves them alone", async () => {
      const { api, el } = await editListed(withOffices, invoiceProfile);
      rename(el);
      await save(el);
      expect(api.updateDeviceProfile).toHaveBeenCalledTimes(1);
      const extras = savedExtras(api) ?? {};
      expect(extras).not.toHaveProperty("invoicePrinterIds");
      expect(extras).not.toHaveProperty("invoicePrinterDefaultId");
    });

    it("a default_not_listed refusal about the invoice default shows under it", async () => {
      const { el } = await editListed({
        ...withOffices,
        updateDeviceProfile: vi.fn().mockRejectedValue({
          code: "device_profile.invalid",
          params: { reason: "default_not_listed", field: "invoicePrinterDefaultId" },
        }),
      });
      rename(el);
      await save(el);
      expect(field(el, "invoice-printers-default").error).toBe(
        t("device_profiles.err_default_not_listed"),
      );
      expect(field(el, "receipt-printers-default").error).toBe("");
    });

    it("copies the invoice list and its default when the profile is duplicated", async () => {
      const { api, el } = await editListed(withOffices, invoiceProfile);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
      await flush(el);
      await profileAction(el, "duplicate-p1");
      await flush(el);
      expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![6]).toMatchObject({
        invoicePrinterIds: ["pg3", "pr2"],
        invoicePrinterDefaultId: "pg3",
      });
    });
  });

  it("lists the venue's card readers, the profile's switched on, with its default", async () => {
    const { el } = await editListed();
    const switches = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement & { checked: boolean; label: string }>(
        "[data-test=profile-readers] wt-switch",
      ),
    ];
    expect(switches.map((s) => [s.label, s.checked])).toEqual([
      ["Front desk", true],
      ["Patio", false],
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
    expect(shownText(el)).toContain(codeMessage("reader.not_found"));
  });

  /** The profile lists r1; Save adds r2 as its default, and r2 was deleted in another tab. */
  async function saveDeletedReader(
    reread: () => Promise<unknown> = async () => [readers[0]!],
    rereadList: ProfileReaderList = { readerIds: ["r1"], defaultReaderId: "r1" },
  ) {
    const { api, el } = await editListed({
      setProfileReaders: vi
        .fn()
        .mockRejectedValueOnce({ code: "reader.not_found", params: { id: "r2" } })
        .mockImplementation((_id, list) => Promise.resolve(list)),
    });
    const reads = vi.mocked(api.listReaders).mock.calls.length;
    vi.mocked(api.listReaders).mockImplementation(reread as never);
    vi.mocked(api.getProfileReaders).mockResolvedValueOnce(rereadList);
    rename(el);
    toggle(el, "profile-reader-r2", true);
    await flush(el);
    await chooseOption(field(el, "profile-readers-default"), "r2");
    await flush(el);
    await save(el);
    return { api, el, reads };
  }

  it.each([
    ["en", "That card reader no longer exists"],
    ["es", "Ese lector de tarjetas ya no existe"],
  ] as const)(
    "a deleted reader in the reader list is refused on Save in %s, then read again: gone from the list and the default",
    async (locale, sentence) => {
      const previous = currentLocale();
      setLocale(locale);
      try {
        const { api, el, reads } = await saveDeletedReader();

        expect(api.setProfileReaders).toHaveBeenCalledExactlyOnceWith("p1", {
          readerIds: ["r1", "r2"],
          defaultReaderId: "r2",
        });
        expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).not.toBeNull();
        expect(bottom(el)).toBe(sentence);

        await vi.waitFor(() =>
          expect(vi.mocked(api.listReaders).mock.calls.length).toBe(reads + 1),
        );
        await flush(el);
        expect(el.shadowRoot!.querySelector("[data-test=profile-reader-r2]")).toBeNull();
        const fallback = field(el, "profile-readers-default");
        expect(fallback.options.map((option) => option.value)).toEqual(["", "r1"]);
        expect(fallback.value).toBe("");
        expect(bottom(el)).toBe(sentence);

        await save(el);
        expect(api.setProfileReaders).toHaveBeenLastCalledWith("p1", {
          readerIds: ["r1"],
          defaultReaderId: null,
        });
      } finally {
        setLocale(previous);
      }
    },
  );

  it.each([
    ["answering", "after"],
    ["failing", "after"],
    ["answering", "before"],
  ] as const)(
    "a deleted reader's re-read %s %s a later Save of the readers leaves the next reader change saved",
    async (outcome, timing) => {
      let answer!: (rows: ReaderRow[]) => void;
      let fail!: (error: unknown) => void;
      let finishSecondSave!: () => void;
      let stored: ProfileReaderList = { readerIds: ["r1"], defaultReaderId: "r1" };
      const { api, el } = await editListed({
        getProfileReaders: vi.fn(async () => structuredClone(stored)),
        setProfileReaders: vi.fn(async (_id: string, list: ProfileReaderList) => {
          if (list.readerIds.includes("r2"))
            throw { code: "reader.not_found", params: { id: "r2" } };
          stored = structuredClone(list);
          return list;
        }),
      });
      vi.mocked(api.listReaders).mockReturnValueOnce(
        new Promise((resolve, reject) => {
          answer = resolve;
          fail = reject;
        }),
      );
      rename(el);
      toggle(el, "profile-reader-r2", true);
      await flush(el);
      await chooseOption(field(el, "profile-readers-default"), "r2");
      await flush(el);
      await save(el);
      await vi.waitFor(() => expect(api.listReaders).toHaveBeenCalledTimes(2));
      if (timing === "before") {
        answer([readers[0]!]);
        await flush(el);
      } else toggle(el, "profile-reader-r2", false);

      await chooseOption(field(el, "profile-readers-default"), "");
      await flush(el);
      vi.mocked(api.updateDeviceProfile).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSecondSave = () => resolve({ ...listedProfile, name: "Renamed" });
          }),
      );
      await save(el);
      rename(el, "Still editing");
      await flush(el);
      finishSecondSave();
      await flush(el);
      await flush(el);
      expect(stored.defaultReaderId).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).not.toBeNull();
      if (timing === "after") {
        if (outcome === "answering") answer([readers[0]!]);
        else fail({ code: "connection.failed" });
      }
      await flush(el);
      await flush(el);
      expect(bottom(el) ?? "").toBe("");

      await chooseOption(field(el, "profile-readers-default"), "r1");
      await flush(el);
      await save(el);
      expect(stored).toEqual({ readerIds: ["r1"], defaultReaderId: "r1" });
    },
  );

  it("a deleted reader's re-read that fails leaves the refusal shown", async () => {
    const { api, el, reads } = await saveDeletedReader(() =>
      Promise.reject({ code: "connection.failed" }),
    );
    await vi.waitFor(() => expect(vi.mocked(api.listReaders).mock.calls.length).toBe(reads + 1));
    await flush(el);
    expect(bottom(el)).toBe(codeMessage("reader.not_found"));
  });

  it.each(["answers", "fails"] as const)(
    "a deleted reader's re-read that %s after the editor was cancelled and opened again leaves the new editor alone",
    async (outcome) => {
      let resolve!: (rows: ReaderRow[]) => void;
      let reject!: (error: unknown) => void;
      const { api, el, reads } = await saveDeletedReader(
        () =>
          new Promise<ReaderRow[]>((res, rej) => {
            resolve = res;
            reject = rej;
          }),
        { readerIds: ["r2"], defaultReaderId: "r2" },
      );
      await vi.waitFor(() => expect(vi.mocked(api.listReaders).mock.calls.length).toBe(reads + 1));

      el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
      vi.mocked(api.listReaders).mockResolvedValue(readers);
      await profileAction(el, "edit-p1");
      await flush(el);
      await flush(el);
      expect(field(el, "profile-readers-default").value).toBe("r1");

      if (outcome === "answers") resolve([]);
      else reject({ code: "connection.failed" });
      await flush(el);
      await flush(el);

      const switches = [
        ...el.shadowRoot!.querySelectorAll<HTMLElement & { checked: boolean }>(
          "[data-test=profile-readers] wt-switch",
        ),
      ];
      expect(switches.map((s) => [s.dataset.test, s.checked])).toEqual([
        ["profile-reader-r1", true],
        ["profile-reader-r2", false],
      ]);
      expect(field(el, "profile-readers-default").value).toBe("r1");
      expect(bottom(el) ?? "").toBe("");
      await expectSaveQuiet(el);
    },
  );

  it("the reader section is absent without the hardware permission", async () => {
    const notPermitted = { code: "authorization.not_permitted" };
    const { api, el } = await editListed({
      getProfileReaders: vi.fn().mockRejectedValue(notPermitted),
      listReaders: vi.fn().mockRejectedValue(notPermitted),
    });
    expect(el.shadowRoot!.querySelector("[data-test=profile-readers]")).toBeNull();
    expect(inScreenOrRow(el, "[role=alert]")).toBeNull();
    rename(el);
    await save(el);
    expect(api.updateDeviceProfile).toHaveBeenCalledTimes(1);
    expect(api.setProfileReaders).not.toHaveBeenCalled();
  });

  const bottom = (el: DeviceProfilesScreen) =>
    inScreenOrRow(el, ".form-message")?.textContent?.trim() ?? null;

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
    expect(shownText(el)).toContain(codeMessage("connection.failed"));
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
    expect(inScreenOrRow(el, "[role=alert]")).toBeNull();
    expect(shownText(el)).not.toContain(codeMessage("connection.failed"));
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
      expect(shownText(el)).not.toContain(codeMessage("reader.not_found"));
    });
  });

  it.each([true, false])(
    "marks a switched-off reader (provider registration retained: %s), and draws none the list did not deliver",
    async (canEnable) => {
      const { el } = await editListed({
        listReaders: vi
          .fn()
          .mockResolvedValue([{ ...readers[0]!, active: false, canEnable }, readers[1]!]),
        getProfileReaders: vi
          .fn()
          .mockResolvedValue({ readerIds: ["r9", "r1"], defaultReaderId: "r1" }),
      });
      const switches = [
        ...el.shadowRoot!.querySelectorAll<HTMLElement & { checked: boolean; label: string }>(
          "[data-test=profile-readers] wt-switch",
        ),
      ];
      const off = `Front desk (${canEnable ? "No disponible" : "Sin vincular"})`;
      expect(switches.map((s) => [s.dataset.test, s.label, s.checked])).toEqual([
        ["profile-reader-r1", off, true],
        ["profile-reader-r2", "Patio", false],
      ]);
      expect(field(el, "profile-readers-default").options).toEqual([
        { value: "", label: t("device_profiles.default_none") },
        { value: "r1", label: off },
      ]);
    },
  );

  it("a duplicate copies the profile's cash drawer list", async () => {
    const withDrawer: DeviceProfile = { ...listedProfile, cashDrawerPrinterIds: ["pr1"] };
    const { api } = await duplicateListed({
      listDeviceProfiles: vi.fn().mockResolvedValue([withDrawer, profiles[1]]),
    });
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p1");
    expect(api.copyDeviceProfile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![6]).toMatchObject({
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
    await profileAction(el, "duplicate-p1");
    await flush(el);
    await flush(el);
    return { api, el };
  }

  it("a duplicate copies the reader list and its default onto the new profile", async () => {
    const { api } = await duplicateListed();
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p1");
    expect(api.getProfileReaders).toHaveBeenCalledWith("p1");
    expect(api.setProfileReaders).toHaveBeenCalledExactlyOnceWith("p9", {
      readerIds: ["r1", "r2"],
      defaultReaderId: "r2",
    });
    expect(vi.mocked(api.copyDeviceProfile).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(api.setProfileReaders).mock.invocationCallOrder[0]!,
    );
  });

  it("a duplicate whose reader copy fails says so at the bottom, and the copy stays", async () => {
    const { api, el } = await duplicateListed({
      setProfileReaders: vi.fn().mockRejectedValue({ code: "reader.not_found" }),
    });
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p1");
    expect(api.copyDeviceProfile).toHaveBeenCalledTimes(1);
    expect(api.deleteDeviceProfile).not.toHaveBeenCalled();
    expect(inScreenOrRow(el, "[role=alert]")?.textContent?.trim()).toBe(
      codeMessage("reader.not_found"),
    );
  });

  it.each([
    [
      "without the hardware permission",
      vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    ],
    [
      "when the profile lists no reader",
      vi.fn().mockResolvedValue({ readerIds: [], defaultReaderId: null }),
    ],
  ])("a duplicate copies no reader list %s, and says nothing", async (_when, getProfileReaders) => {
    const { api, el } = await duplicateListed({ getProfileReaders });
    expect(vi.mocked(api.copyDeviceProfile).mock.calls[0]![0]).toBe("p1");
    expect(api.copyDeviceProfile).toHaveBeenCalledTimes(1);
    expect(api.setProfileReaders).not.toHaveBeenCalled();
    expect(inScreenOrRow(el, "[role=alert]")).toBeNull();
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
        await profileAction(el, "edit-p1");
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
  await profileAction(el, "edit-p1");
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
    inScreenOrRow(el, ".form-message")?.textContent?.trim() ?? null;
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
        expect(inScreenOrRow(el, "[role=alert]")?.textContent?.trim()).toBe(
          codeMessage("connection.failed"),
        ),
      );
      if (open === "create")
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
      else await profileAction(el, open);
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
      { id: "pr1", name: "Bar", active: true, hasCashDrawer: false } as Printer,
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
      expect(inScreenOrRow(el, "[role=alert]")?.textContent?.trim()).toBe(
        codeMessage("connection.failed"),
      ),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).not.toBeNull();
    expect(bottom(el)).toBe(codeMessage("connection.failed"));
    expect(noPrinters(el)).toBeNull();
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
    const alert = () => inScreenOrRow(el, "[role=alert]")?.textContent?.trim();
    await profileAction(el, "delete-p1");
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

  it("says the printers are loading while a read after a failed one is under way", async () => {
    const liveData = new LiveData();
    const listPrinters = vi.fn().mockRejectedValue({ code: "connection.failed" });
    const el = await mount(stubApi({ listPrinters, liveData } as Partial<DashboardApi>));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    expect(loadingLine(el)).toBeNull();
    listPrinters.mockReturnValue(new Promise(() => undefined));
    liveData.refresh();
    await vi.waitFor(() => expect(listPrinters).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(loadingLine(el)?.textContent?.trim()).toBe(t("device_profiles.printers_loading"));
    expect(noPrinters(el)).toBeNull();
  });

  it("does not say to add a printer when a refresh of an empty printer list failed", async () => {
    const liveData = new LiveData();
    const listPrinters = vi.fn().mockResolvedValue([]);
    const el = await mount(stubApi({ listPrinters, liveData } as Partial<DashboardApi>));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    expect(noPrinters(el)).not.toBeNull();
    listPrinters.mockRejectedValue({ code: "connection.failed" });
    liveData.refresh();
    await vi.waitFor(() => expect(bottom(el)).toBe(codeMessage("connection.failed")));
    expect(noPrinters(el)).toBeNull();
    listPrinters.mockResolvedValue([]);
    liveData.refresh();
    await vi.waitFor(() => expect(noPrinters(el)).not.toBeNull());
  });

  it("puts a standing read failure back on the list after Cancel", async () => {
    const el = await mount(
      stubApi({ listPrinters: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
    );
    const alert = () => inScreenOrRow(el, "[role=alert]")?.textContent?.trim();
    await vi.waitFor(() => expect(alert()).toBe(codeMessage("connection.failed")));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
    expect(alert()).toBe(codeMessage("connection.failed"));
  });
});

it("service deletion refreshes native profile zones and chooses a permitted starting replacement", async () => {
  const before = currentLocale();
  try {
    setLocale("en");
    const api = Object.assign(stubApi(), { liveData: new LiveData() });
    const el = await mount(api);
    await profileAction(el, "edit-p1");
    await flush(el);
    rename(el, "Retained draft");
    vi.mocked(api.getProfileScopeChoices).mockResolvedValue({
      ...scopeChoices,
      zones: scopeChoices.zones.filter((z) => z.id !== "z1"),
    });
    api.liveData.invalidate([{ type: "floor_zones", id: "z1" }]);
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
          "[data-test=profile-starting-zone]",
        )!.value,
      ).toBe("z2"),
    );
    expect(el.shadowRoot!.querySelector("[data-test=profile-zone-z1]")).toBeNull();
    const start = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[data-test=profile-starting-zone]",
    )!;
    await start.updateComplete;
    expect(start.shadowRoot!.querySelector("button")!.textContent).toContain("Terrace");
    expect(start.value).toBe("z2");
    expect(
      el
        .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=profile-name]")!
        .shadowRoot!.querySelector("input")!.value,
    ).toBe("Retained draft");
  } finally {
    setLocale(before);
  }
});
it("service deletion empty zone bound survives native unrelated save and actual UI Copy endpoint", async () => {
  const before = currentLocale();
  try {
    setLocale("en");
    const kitchen = { ...profiles[1]!, id: "p2" };
    const screens = [
      { profileId: "p2", screens: { pass_monitor: { stationIds: null, zoneIds: [] } } },
    ];
    const writes: [string, unknown][] = [];
    const real = new RealDashboardApi("", async (path, init) => {
      writes.push([String(path), JSON.parse(init.body as string)]);
      return new Response(JSON.stringify({ ...kitchen, id: "copy" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    const api = Object.assign(
      stubApi({
        listDeviceProfiles: vi.fn().mockResolvedValue([kitchen]),
        getDeviceProfile: vi.fn().mockResolvedValue(kitchen),
        listProfileKitchenScreens: vi.fn().mockResolvedValue(screens),
      }),
      {
        createDeviceProfile: vi.fn(real.createDeviceProfile.bind(real)),
        copyDeviceProfile: real.copyDeviceProfile.bind(real),
      },
    );
    const el = await mount(api);
    await profileAction(el, "edit-p2");
    await flush(el);
    const every = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
      "[data-test=profile-pass-monitor-every-zone]",
    )!;
    await every.updateComplete;
    expect(every.shadowRoot!.querySelector("input")!.checked).toBe(false);
    const name = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      "[data-test=profile-name]",
    )!;
    await name.updateComplete;
    await userEvent.fill(
      page.elementLocator(name.shadowRoot!.querySelector("input")!),
      "Renamed kitchen",
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await vi.waitFor(() => expect(api.updateDeviceProfile).toHaveBeenCalledOnce());
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]![6]).toBeUndefined();
    await vi.waitFor(() =>
      expect(profileListRoot(el).querySelector("[data-test=duplicate-p2]")).not.toBeNull(),
    );
    await profileAction(el, "duplicate-p2");
    await vi.waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]![0]).toBe("/management-api/device-profiles/p2/copy");
    expect(writes[0]![1]).toEqual({
      admittedStaffRoleIds: ["job-waiter", "job-chef"],
      name: "Kitchen (copy)",

      capabilities: [],
      formFactor: "kds",
      inactivityTimeoutSeconds: null,
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
      kitchenScreens: { pass_monitor: { stationIds: null, zoneIds: [] } },
    });
    expect(api.createDeviceProfile).not.toHaveBeenCalled();
  } finally {
    setLocale(before);
  }
});

const scopeBottom = (el: DeviceProfilesScreen) =>
  inScreenOrRow(el, ".form-message")?.textContent?.trim() ?? null;

it("scope reader recovery clears its own refusal", async () => {
  const api = Object.assign(stubApi(), { liveData: new LiveData() });
  const el = await mount(api);
  await profileAction(el, "edit-p1");
  await flush(el);
  vi.mocked(api.getProfileScopeChoices).mockRejectedValue({ code: "connection.failed" });
  api.liveData.invalidate([{ type: "floor_zones", id: "z1" }]);
  await vi.waitFor(() => expect(scopeBottom(el)).toBe(codeMessage("connection.failed")));
  vi.mocked(api.getProfileScopeChoices).mockResolvedValue(scopeChoices);
  api.liveData.invalidate([{ type: "floor_zones", id: "z1" }]);
  await vi.waitFor(() => expect(scopeBottom(el)).toBeNull());
});

it("scope reader refusal survives the main list reader recovery", async () => {
  const api = Object.assign(stubApi(), { liveData: new LiveData() });
  const el = await mount(api);
  await profileAction(el, "edit-p1");
  await flush(el);
  vi.mocked(api.listPrinters).mockRejectedValue({ code: "server.internal" });
  api.liveData.invalidate([{ type: "printers", id: "pr1" }]);
  await vi.waitFor(() => expect(scopeBottom(el)).toBe(codeMessage("server.internal")));
  vi.mocked(api.getProfileScopeChoices).mockRejectedValue({ code: "connection.failed" });
  api.liveData.invalidate([{ type: "floor_zones", id: "z1" }]);
  await vi.waitFor(() => expect(scopeBottom(el)).toBe(codeMessage("connection.failed")));
  vi.mocked(api.listPrinters).mockResolvedValue([]);
  api.liveData.invalidate([{ type: "printers", id: "pr1" }]);
  await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(3));
  await flush(el);
  expect(scopeBottom(el)).toBe(codeMessage("connection.failed"));
});

it("scope reader recovery preserves a later action refusal", async () => {
  const api = Object.assign(
    stubApi({
      updateDeviceProfile: vi.fn().mockRejectedValue({ code: "server.internal" }),
    }),
    { liveData: new LiveData() },
  );
  const el = await mount(api);
  await profileAction(el, "edit-p1");
  await flush(el);
  vi.mocked(api.getProfileScopeChoices).mockRejectedValue({ code: "connection.failed" });
  api.liveData.invalidate([{ type: "floor_zones", id: "z1" }]);
  await vi.waitFor(() => expect(scopeBottom(el)).toBe(codeMessage("connection.failed")));
  rename(el, "Pending edit");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
  await vi.waitFor(() => expect(scopeBottom(el)).toBe(codeMessage("server.internal")));
  vi.mocked(api.getProfileScopeChoices).mockResolvedValue(scopeChoices);
  api.liveData.invalidate([{ type: "floor_zones", id: "z1" }]);
  await vi.waitFor(() => expect(api.getProfileScopeChoices).toHaveBeenCalledTimes(3));
  await flush(el);
  expect(scopeBottom(el)).toBe(codeMessage("server.internal"));
});

it("scope opening keeps a newer zone snapshot after the held profile read", async () => {
  const before = currentLocale();
  try {
    setLocale("en");
    let release!: (profile: DeviceProfile) => void;
    const profile = new Promise<DeviceProfile>((resolve) => {
      release = resolve;
    });
    const api = Object.assign(stubApi({ getDeviceProfile: vi.fn(() => profile) }), {
      liveData: new LiveData(),
    });
    const el = await mount(api);
    await profileAction(el, "edit-p1");
    await vi.waitFor(() => expect(api.getProfileScopeChoices).toHaveBeenCalledOnce());
    await flush(el);
    vi.mocked(api.getProfileScopeChoices).mockResolvedValue({
      ...scopeChoices,
      zones: scopeChoices.zones.filter((zone) => zone.id !== "z1"),
    });
    api.liveData.invalidate([{ type: "floor_zones", id: "z1" }]);
    await vi.waitFor(() => expect(api.getProfileScopeChoices).toHaveBeenCalledTimes(3));
    await flush(el);
    release({ ...profiles[0]!, name: "Held profile draft", allowedZoneIds: ["z1", "z2"] });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=profile-starting-zone]")).not.toBeNull(),
    );
    const start = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[data-test=profile-starting-zone]",
    )!;
    await start.updateComplete;
    expect(start.value).toBe("z2");
    expect(start.shadowRoot!.querySelector("button")!.textContent).toContain("Terrace");
    expect(el.shadowRoot!.querySelector("[data-test=profile-zone-z1]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=profile-zone-z2]")).not.toBeNull();
    const name = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      "[data-test=profile-name]",
    )!;
    await name.updateComplete;
    expect(name.shadowRoot!.querySelector("input")!.value).toBe("Held profile draft");
  } finally {
    setLocale(before);
  }
});

describe("A182 canvas retirement", () => {
  it("loads profiles and edits their name without reading or selecting a canvas", async () => {
    const listCanvases = vi.fn(async () => []);
    const api = Object.assign(stubApi(), { listCanvases });
    const el = await mount(api);
    expect(listCanvases).not.toHaveBeenCalled();
    await profileAction(el, "edit-p1");
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=profile-canvas]")).toBeNull();
    rename(el, "Fixed counter");
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await vi.waitFor(() => expect(api.updateDeviceProfile).toHaveBeenCalled());
    expect(vi.mocked(api.updateDeviceProfile).mock.calls[0]!.slice(0, 6)).toEqual([
      "p1",
      "Fixed counter",
      ["integrated-card-payment", "open-cash-drawer"],
      "till",
      null,
      NO_PRINTERS,
    ]);
  });
});

describe("a device profile's address", () => {
  afterEach(() => vi.restoreAllMocks());

  const editingId = (el: DeviceProfilesScreen) =>
    el.shadowRoot!.querySelector("[data-test=editor-form]")?.getAttribute("data-editing-id") ??
    null;

  it("ordinary Edit ignores a tab on the list address", async () => {
    history.replaceState(null, "", "/device-profiles/view/equipment");
    const el = await mount(stubApi());
    await profileAction(el, "edit-p1");
    await vi.waitFor(() => expect(editingId(el)).toBe("p1"));
    expect(el.shadowRoot!.querySelector("wt-tabs")).toHaveProperty("value", "general");
    expect(location.pathname).toBe("/device-profiles/profile/p1");
  });
  it("a field error writes the tab it opens", async () => {
    history.replaceState(null, "", "/device-profiles/profile/p1/view/where");
    const el = await mount(stubApi());
    change(el, "profile-name", "");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-tabs")).toHaveProperty("value", "general"),
    );
    expect(location.pathname).toBe("/device-profiles/profile/p1/view/general");
  });

  it("opens an explicit tab and follows same-profile addresses without reloading", async () => {
    history.replaceState(null, "", "/device-profiles/profile/p1/view/equipment");
    const api = stubApi();
    const el = await mount(api);
    await vi.waitFor(() => expect(editingId(el)).toBe("p1"));
    expect(el.shadowRoot!.querySelector("wt-tabs")).toHaveProperty("value", "equipment");
    await selectProfileTab(el, "who");
    expect(location.pathname).toBe("/device-profiles/profile/p1/view/who");
    history.replaceState(null, "", "/device-profiles/profile/p1/view/where");
    dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-tabs")).toHaveProperty("value", "where"),
    );
    expect(api.getDeviceProfile).toHaveBeenCalledTimes(1);
    const host = el.parentElement!;
    el.remove();
    host.append(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-tabs")).toHaveProperty("value", "where"),
    );
  });
  it.each(["unknown", "where"])("refuses an invalid or unoffered explicit tab %s", async (tab) => {
    history.replaceState(null, "", `/device-profiles/profile/p2/view/${tab}`);
    const el = await mount(stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(profiles[1]) }));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain(t("device_profiles.setting_unavailable")),
    );
    expect(el.shadowRoot!.querySelector("wt-tabs")).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-target-cancel]")!.click();
    await vi.waitFor(() => expect(location.pathname).toBe("/device-profiles"));
  });

  it("names the profile while its editor is open, so a reload opens it again", async () => {
    history.replaceState(null, "", "/device-profiles");
    const api = stubApi();
    const el = await mount(api);
    const replace = vi.spyOn(history, "replaceState");
    const push = vi.spyOn(history, "pushState");
    await profileAction(el, "edit-p1");
    await vi.waitFor(() => expect(editingId(el)).toBe("p1"));
    expect(location.pathname).toBe("/device-profiles/profile/p1");
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    const address = location.href;
    cleanupWidgets();
    history.replaceState(null, "", address);
    const reloaded = await mount(stubApi());
    await vi.waitFor(() => expect(editingId(reloaded)).toBe("p1"));
    expect(location.pathname).toBe("/device-profiles/profile/p1");
  });

  it("leaves the profile's name out of the address when Cancel closes its editor", async () => {
    history.replaceState(null, "", "/device-profiles/profile/p1");
    const el = await mount();
    await vi.waitFor(() => expect(editingId(el)).toBe("p1"));
    const push = vi.spyOn(history, "pushState");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-cancel]")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull(),
    );
    expect(location.pathname).toBe("/device-profiles");
    expect(push).not.toHaveBeenCalled();
  });

  it("leaves the profile's name out of the address when a save closes its editor", async () => {
    history.replaceState(null, "", "/device-profiles/profile/p1");
    const api = stubApi();
    const el = await mount(api);
    await vi.waitFor(() => expect(editingId(el)).toBe("p1"));
    rename(el);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull(),
    );
    expect(api.updateDeviceProfile).toHaveBeenCalled();
    expect(location.pathname).toBe("/device-profiles");
  });

  it("closes the editor when Back takes the profile's name out of the address", async () => {
    history.replaceState(null, "", "/device-profiles/profile/p1");
    const el = await mount();
    await vi.waitFor(() => expect(editingId(el)).toBe("p1"));
    history.replaceState(null, "", "/device-profiles");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
    expect(profileListRoot(el).querySelector('[data-row-key="p1"]')).toBeTruthy();
  });

  it("keeps a new profile's editor when the address comes back from another page naming no profile", async () => {
    history.replaceState(null, "", "/device-profiles");
    const el = await mount();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    change(el, "profile-name", "New counter");
    await el.updateComplete;
    history.replaceState(null, "", "/profile");
    window.dispatchEvent(new PopStateEvent("popstate"));
    history.replaceState(null, "", "/device-profiles");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush(el);
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=profile-name]")
        ?.value,
    ).toBe("New counter");
  });

  it("closes an editor opened from the list when Back takes its name out of the address", async () => {
    history.replaceState(null, "", "/device-profiles");
    const el = await mount();
    await profileAction(el, "edit-p1");
    await vi.waitFor(() => expect(editingId(el)).toBe("p1"));
    history.replaceState(null, "", "/device-profiles");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
  });

  it("opens the profile its address names, once", async () => {
    history.replaceState(null, "", "/device-profiles/profile/p2");
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const api = stubApi({ getDeviceProfile: vi.fn().mockResolvedValue(profiles[1]) });
    const el = await mount(api);
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector("[data-test=editor-form]")?.getAttribute("data-editing-id"),
      ).toBe("p2"),
    );
    expect(api.getDeviceProfile).toHaveBeenCalledTimes(1);
    expect(api.getDeviceProfile).toHaveBeenCalledWith("p2");
    expect(location.pathname).toBe("/device-profiles/profile/p2");
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush(el);
    expect(api.getDeviceProfile).toHaveBeenCalledTimes(1);
  });

  it("takes the profile's name out of the address when the profile it names cannot be read", async () => {
    history.replaceState(null, "", "/device-profiles/profile/p1");
    const push = vi.spyOn(history, "pushState");
    const api = stubApi({
      getDeviceProfile: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const el = await mount(api);
    await vi.waitFor(() => expect(inScreenOrRow(el, "[role=alert]")).toBeTruthy());
    expect(api.getDeviceProfile).toHaveBeenCalledWith("p1");
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
    expect(profileListRoot(el).querySelector('[data-row-key="p1"]')).toBeTruthy();
    expect(location.pathname).toBe("/device-profiles");
    expect(push).not.toHaveBeenCalled();
  });

  it("opens nothing for an address naming no profile", async () => {
    history.replaceState(null, "", "/device-profiles/profile/gone");
    const push = vi.spyOn(history, "pushState");
    const api = stubApi();
    const el = await mount(api);
    await vi.waitFor(() => expect(location.pathname).toBe("/device-profiles"));
    expect(api.getDeviceProfile).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-test=editor-form]")).toBeNull();
    expect(profileListRoot(el).querySelector('[data-row-key="p1"]')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});

it("clears a duplicate's direct reload failure when live profiles arrive", async () => {
  const api = Object.assign(stubApi(), { liveData: new LiveData() });
  const el = await mount(api);
  vi.mocked(api.listDeviceProfiles).mockRejectedValueOnce({ code: "connection.failed" });
  await profileAction(el, "duplicate-p1");
  await vi.waitFor(() =>
    expect(inScreenOrRow(el, "[role=alert]")?.textContent).toContain(
      codeMessage("connection.failed"),
    ),
  );
  api.liveData.refresh();
  await vi.waitFor(() => expect(api.listDeviceProfiles).toHaveBeenCalledTimes(3));
  await flush(el);
  expect(inScreenOrRow(el, "[role=alert]")).toBeNull();
});

let receivedLocale: string;
beforeEach(() => {
  receivedLocale = currentLocale();
  setLocale("es-ES");
});
afterEach(() => setLocale(receivedLocale));

it("keeps a card-reader load refusal through live profiles", async () => {
  const api = Object.assign(
    stubApi({ listReaders: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
    { liveData: new LiveData() },
  );
  const el = await mount(api);
  await profileAction(el, "edit-p1");
  await vi.waitFor(() => expect(scopeBottom(el)).toBe(codeMessage("connection.failed")));
  api.liveData.refresh();
  await vi.waitFor(() => expect(api.listDeviceProfiles).toHaveBeenCalledTimes(2));
  await flush(el);
  expect(scopeBottom(el)).toBe(codeMessage("connection.failed"));
});

describe("the editor's message in a short scroller", () => {
  it("lies directly above the held Save row and in view after a refusal", async () => {
    const el = await mount(stubApi());
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    change(el, "profile-name", "   ");
    toggle(el, "cap-take-cash", true);
    await el.updateComplete;
    const scroller = el.parentElement!;
    scroller.style.height = "300px";
    scroller.style.overflow = "auto";
    scroller.scrollTop = 0;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
    await flush(el);
    const row = el.shadowRoot!.querySelector("wt-form-actions")!;
    await row.updateComplete;
    const alert = inScreenOrRow(el, "[role=alert]")!;
    expect(alert.textContent!.trim()).toBe(t("form.fix_fields"));
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    const view = scroller.getBoundingClientRect();
    const message = alert.getBoundingClientRect();
    const save = el.shadowRoot!.querySelector("[data-test=profile-save]")!.getBoundingClientRect();
    expect(save.bottom).toBeLessThanOrEqual(view.bottom + 0.5);
    expect(message.top).toBeGreaterThanOrEqual(view.top);
    expect(message.bottom).toBeLessThanOrEqual(save.top);
    expect(save.top - message.bottom).toBeLessThan(save.height);
  });
});
