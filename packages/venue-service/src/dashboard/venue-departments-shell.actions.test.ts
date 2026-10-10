import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { page, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import { departmentHoursModel } from "../testing/department-hours-fixture.js";
import { placedZonePlan } from "../testing/department-zones-fixture.js";
import "./venue-departments-shell.js";

const initialUrl = location.href;
const hosts: HTMLElement[] = [];
function view(): VenueServiceView {
  return {
    departments: [
      {
        id: "d1",
        name: "Restaurant",
        tradingName: "Casa",
        active: true,
      },
      { id: "d2", name: "Deli", tradingName: "Shop", active: false },
    ],
    zones: ["z1", "z2"].map((id) => ({
      id,
      name: id,
      active: true,
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "prepay",
    })),
    floorZones: ["z1", "z2"].map((id) => ({ id, name: id, active: true })),
    salePolicies: { departments: [], zones: [] },
    readiness: [],
    settings: { editSentLines: true },
    kitchenTicketGrouping: "combined",
    printHeldWork: false,
    releaseReminderMinutes: null,
    clearingWorkflow: false,
  };
}
beforeEach(() => setLocale("en"));
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  vi.restoreAllMocks();
  history.replaceState(null, "", initialUrl);
  setLocale("en");
});
async function mount(
  path = "/manage/venue-operations",
  model = view(),
  write?: Promise<unknown>,
  read?: Promise<unknown>,
) {
  history.replaceState(null, "", path);
  const shell = document.createElement("venue-departments-shell");
  applyTokens(shell);
  let loaded = structuredClone(model);
  let readFailure: unknown;
  let writeFailure: unknown;
  const request = vi.fn(async (url: string, method = "GET") => {
    if (method !== "GET") {
      if (writeFailure) throw writeFailure;
      await write;
      return { id: "new" };
    }
    if (url === "/management-api/venue-service") {
      await read;
      if (readFailure) throw readFailure;
      return loaded;
    }
    if (url === "/management-api/zones?includeInactive=true") return loaded.floorZones;
    if (url.endsWith("/profiles")) return [];
    if (url.endsWith("/removal-impact")) return { zones: [] };
    return { departmentId: "d1", receivingProfileId: null, destinationDepartmentIds: [] };
  });
  shell.api = new VenueServiceApi(((...args: Parameters<DashboardRequest>) => {
    const [url, method] = args;
    if (url === "/management-api/venue-service/opening-hours" && method === "GET")
      return Promise.resolve(departmentHoursModel());
    if (url.endsWith("/floor-plan") && method === "GET")
      return Promise.resolve(structuredClone(placedZonePlan));
    return (request as DashboardRequest)(...args);
  }) as DashboardRequest);
  shell.model = model;
  hosts.push(shell);
  document.body.append(shell);
  await shell.updateComplete;
  return {
    shell,
    request,
    loaded: (next: VenueServiceView) => {
      loaded = next;
    },
    failRead: (error: unknown) => {
      readFailure = error;
    },
    failWrite: (error: unknown) => {
      writeFailure = error;
    },
  };
}
function emit(el: HTMLElement, name: string, detail: object = {}) {
  el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
async function dialogs(shell: HTMLElementTagNameMap["venue-departments-shell"]) {
  await expect
    .poll(() => shell.shadowRoot!.querySelector("department-dialogs")?.dialog)
    .toBeDefined();
  const el = shell.shadowRoot!.querySelector("department-dialogs")!;
  await el.updateComplete;
  return el;
}
async function saveName(el: HTMLElementTagNameMap["department-dialogs"], name: string) {
  emit(el.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: name });
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
}
function alert(shell: HTMLElementTagNameMap["venue-departments-shell"]) {
  return shell.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim() ?? "";
}
it.each([
  ["rename-department", { departmentId: "d1" }, "rename-department", "d1"],
  ["disable-department", { departmentId: "d1" }, "disable-department", "d1"],
  ["rename-zone", { zoneId: "z1" }, "rename-zone", "z1"],
  ["move-zone", { zoneId: "z1" }, "move-zone", "z1"],
  ["add-to-department", { zoneId: "z1" }, "add-to-department", "z1"],
  ["disable-zone", { zoneId: "z1" }, "disable-zone", "z1"],
] as const)("%s opens the dialog for its recorded row", async (event, detail, kind, id) => {
  const { shell } = await mount();
  emit(shell.shadowRoot!.querySelector("departments-list")!, event, detail);
  const el = await dialogs(shell);
  expect(el.dialog!.kind).toBe(kind);
  expect("row" in el.dialog! && el.dialog!.row.id).toBe(id);
});
it("Add zone uses the viewed department", async () => {
  const { shell } = await mount("/manage/venue-operations/department/d1/view/zones");
  emit(shell.shadowRoot!.querySelector("department-zones")!, "add-zone");
  expect((await dialogs(shell)).dialog).toEqual({ kind: "add-zone", departmentId: "d1" });
});
it("unknown action ids do not open a dialog or write", async () => {
  const { shell, request } = await mount();
  emit(shell.shadowRoot!.querySelector("departments-list")!, "rename-department", {
    departmentId: "gone",
  });
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector("department-dialogs")?.dialog).toBeUndefined();
  expect(request).not.toHaveBeenCalled();
});
it("Add saves once, closes, refreshes passively and opens the created department", async () => {
  const { shell, request, loaded } = await mount();
  const next = view();
  next.departments.push({
    id: "new",
    name: "Brunch",
    tradingName: "",
    active: true,
  });
  loaded(next);
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  await list.updateComplete;
  list.shadowRoot!.querySelector<HTMLElement>("[data-test=add-department]")!.click();
  const el = await dialogs(shell);
  await saveName(el, " Brunch ");
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations/department/new");
  expect(el.dialog).toBeUndefined();
  expect(shell.model.departments.find((row) => row.id === "new")!.name).toBe("Brunch");
  expect(request.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(1);
  expect(request).toHaveBeenCalledWith("/management-api/venue-service/departments", "POST", {
    name: "Brunch",
  });
  expect(request).toHaveBeenCalledWith("/management-api/venue-service", "GET", undefined, {
    passive: true,
  });
});
it("Cancel returns focus to the real Add button", async () => {
  const { shell } = await mount();
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  await list.updateComplete;
  const opener = list.shadowRoot!.querySelector<HTMLElement>("[data-test=add-department]")!;
  opener.click();
  const el = await dialogs(shell);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => el.dialog).toBeUndefined();
  await expect.poll(() => list.shadowRoot!.activeElement).toBe(opener);
});
it("a successful write with failed refresh closes the dialog and reports a load failure", async () => {
  const { shell, failRead, request } = await mount();
  failRead(new Error("offline"));
  emit(shell.shadowRoot!.querySelector("departments-list")!, "add-department");
  const el = await dialogs(shell);
  await saveName(el, "Brunch");
  await expect.poll(() => alert(shell)).toBe("The venue configuration could not be loaded.");
  expect(el.dialog).toBeUndefined();
  expect(alert(shell)).not.toContain("saved");
  expect(request.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(1);
});
it.each(["department", "zone"] as const)(
  "Enable %s sends only active:true and refreshes",
  async (kind) => {
    const { shell, loaded, request } = await mount();
    const next = view();
    next.departments[1]!.active = true;
    loaded(next);
    emit(
      shell.shadowRoot!.querySelector("departments-list")!,
      `enable-${kind}`,
      kind === "department" ? { departmentId: "d2" } : { zoneId: "z1" },
    );
    await expect
      .poll(() => request.mock.calls.filter((call) => call[1] === "PATCH").length)
      .toBe(1);
    expect(request).toHaveBeenCalledWith(
      kind === "department"
        ? "/management-api/venue-service/departments/d2"
        : "/management-api/zones/z1",
      "PATCH",
      { active: true },
    );
    await expect.poll(() => shell.model.departments[1]!.active).toBe(true);
  },
);
it("Enable refusal keeps the disabled department and permits a second attempt", async () => {
  const { shell, failWrite, loaded } = await mount("/manage/venue-operations/department/d2");
  failWrite({ code: "department.not_found" });
  const page = shell.shadowRoot!.querySelector("department-page")!;
  await page.updateComplete;
  page.shadowRoot!.querySelector<HTMLElement>("[data-test=enable-department]")!.click();
  await expect.poll(() => alert(shell)).toBe("The change could not be saved.");
  expect(shell.model.departments[1]!.active).toBe(false);
  failWrite(undefined);
  const next = view();
  next.departments[1]!.active = true;
  loaded(next);
  page.shadowRoot!.querySelector<HTMLElement>("[data-test=enable-department]")!.click();
  await expect.poll(() => shell.model.departments[1]!.active).toBe(true);
  expect(alert(shell)).toBe("");
});
it("zone Enable explains its disabled department", async () => {
  const { shell, failWrite } = await mount();
  failWrite({ code: "zone.department_inactive" });
  emit(shell.shadowRoot!.querySelector("departments-list")!, "enable-zone", { zoneId: "z1" });
  await expect
    .poll(() => alert(shell))
    .toBe(
      "That zone needs an active department. Enable its department or assign it to an active one first",
    );
});
it("a moved zone leaves the current tab and chooses the first remaining zone", async () => {
  const { shell, loaded } = await mount(
    "/manage/venue-operations/department/d1/view/zones/zone/z1",
  );
  const next = view();
  next.zones[0]!.departmentId = "d2";
  loaded(next);
  const zones = shell.shadowRoot!.querySelector("department-zones")!;
  emit(zones, "move-zone", { zoneId: "z1" });
  const el = await dialogs(shell);
  const moved = view();
  moved.departments[1]!.active = true;
  shell.model = moved;
  await shell.updateComplete;
  await el.updateComplete;
  emit(el.shadowRoot!.querySelector("[name=departmentId]")!, "wt-change", { value: "d2" });
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await expect.poll(() => zones.zone).toBe("z2");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1/view/zones/zone/z2");
});
it("refresh completion retains a newer externally delivered model", async () => {
  const { shell } = await mount();
  let release!: (model: VenueServiceView) => void;
  const pending = new Promise<VenueServiceView>((resolve) => {
    release = resolve;
  });
  const read = vi.fn(() => pending);
  vi.spyOn(shell.api, "background", "get").mockReturnValue({
    load: read,
  } as unknown as VenueServiceApi);
  emit(shell.shadowRoot!.querySelector("departments-list")!, "enable-department", {
    departmentId: "d2",
  });
  await expect.poll(() => read.mock.calls.length).toBe(1);
  const newer = view();
  newer.departments[0]!.name = "New live name";
  shell.model = newer;
  await shell.updateComplete;
  release(view());
  await shell.updateComplete;
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
  expect(shell.model.departments[0]!.name).toBe("New live name");
});

it("Cancel returns focus to the real Add zone button", async () => {
  const { shell } = await mount("/manage/venue-operations/department/d1/view/zones");
  const zones = shell.shadowRoot!.querySelector("department-zones")!;
  await zones.updateComplete;
  const opener = zones.shadowRoot!.querySelector<HTMLElement>("[data-test=add-zone]")!;
  opener.click();
  const el = await dialogs(shell);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => el.dialog).toBeUndefined();
  await expect.poll(() => zones.shadowRoot!.activeElement).toBe(opener);
});
it.each([0, 2])("adding a zone returns focus to Add with %i prior zones", async (count) => {
  const model = view();
  model.zones = model.zones.slice(0, count);
  model.floorZones = model.floorZones.slice(0, count);
  const { shell, loaded, request } = await mount(
    "/manage/venue-operations/department/d1/view/zones",
    model,
  );
  const zones = shell.shadowRoot!.querySelector("department-zones")!;
  await zones.updateComplete;
  const opener = zones.shadowRoot!.querySelector<HTMLElement>("[data-test=add-zone]")!;
  const next = structuredClone(model);
  next.zones.push({ ...view().zones[0]!, id: "new", name: "Garden" });
  next.floorZones.push({ id: "new", name: "Garden", active: true });
  loaded(next);
  opener.click();
  const el = await dialogs(shell);
  await saveName(el, "Garden");
  await expect.poll(() => el.dialog).toBeUndefined();
  await expect
    .poll(() => location.pathname)
    .toBe("/manage/venue-operations/department/d1/view/zones/zone/new");
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
  expect(request.mock.calls.filter((call) => call[1] === "POST")).toEqual([
    ["/management-api/venue-service/zones", "POST", { name: "Garden", departmentId: "d1" }],
  ]);
  await expect.poll(() => zones.shadowRoot!.activeElement).toBe(opener);
});
it("zone Enable closes its real popover before the request completes", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const model = view();
  model.zones[0]!.active = false;
  model.floorZones[0]!.active = false;
  const { shell, request } = await mount(
    "/manage/venue-operations/department/d1/view/zones/zone/z1",
    model,
    pending,
  );
  const zones = shell.shadowRoot!.querySelector("department-zones")!;
  await zones.updateComplete;
  const action = zones.shadowRoot!.querySelector<HTMLElement>("[data-test=enable-zone]")!;
  const menu = action.closest("wt-row-actions")!;
  await menu.updateComplete;
  const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  try {
    await userEvent.click(menu.shadowRoot!.querySelector("button")!);
    expect(popup.matches(":popover-open")).toBe(true);
    await userEvent.click(action);
    await expect
      .poll(() => request.mock.calls.filter((call) => call[1] === "PATCH").length)
      .toBe(1);
    expect(request).toHaveBeenCalledWith("/management-api/zones/z1", "PATCH", { active: true });
    expect(popup.matches(":popover-open")).toBe(false);
    expect(shell.shadowRoot!.querySelector("department-dialogs")!.dialog).toBeUndefined();
  } finally {
    release();
    await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
  }
});
it.each(["cancel", "save"] as const)(
  "Rename %s restores the department row-menu trigger",
  async (ending) => {
    const { shell } = await mount();
    const list = shell.shadowRoot!.querySelector("departments-list")!;
    await list.updateComplete;
    const table = list.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const action = table.shadowRoot!.querySelector<HTMLElement>(
      "[data-test=rename-department-d1]",
    )!;
    const menu = action.closest("wt-row-actions")!;
    await menu.updateComplete;
    const trigger = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    trigger.click();
    action.click();
    const el = await dialogs(shell);
    if (ending === "save") await saveName(el, "New name");
    else el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
    await expect.poll(() => el.dialog).toBeUndefined();
    await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
    await expect.poll(() => menu.shadowRoot!.activeElement).toBe(trigger);
  },
);
it("a late refresh refusal does not hide a newer successfully delivered snapshot", async () => {
  const { shell } = await mount();
  let reject!: (error: Error) => void;
  const read = vi.fn(
    () =>
      new Promise<VenueServiceView>((_, no) => {
        reject = no;
      }),
  );
  vi.spyOn(shell.api, "background", "get").mockReturnValue({
    load: read,
  } as unknown as VenueServiceApi);
  emit(shell.shadowRoot!.querySelector("departments-list")!, "enable-department", {
    departmentId: "d2",
  });
  await expect.poll(() => read.mock.calls.length).toBe(1);
  const newer = view();
  newer.departments[0]!.name = "New live name";
  shell.model = newer;
  await shell.updateComplete;
  reject(new Error("old load failed"));
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
  expect(alert(shell)).toBe("");
  expect(shell.model.departments[0]!.name).toBe("New live name");
});
it("a refresh finishing after browser navigation does not reopen the created department", async () => {
  const { shell } = await mount();
  let release!: (model: VenueServiceView) => void;
  const read = vi.fn(
    () =>
      new Promise<VenueServiceView>((yes) => {
        release = yes;
      }),
  );
  vi.spyOn(shell.api, "background", "get").mockReturnValue({
    load: read,
  } as unknown as VenueServiceApi);
  emit(shell.shadowRoot!.querySelector("departments-list")!, "add-department");
  await saveName(await dialogs(shell), "Brunch");
  await expect.poll(() => read.mock.calls.length).toBe(1);
  history.pushState(null, "", "/manage/venue-operations/department/d1");
  dispatchEvent(new PopStateEvent("popstate"));
  await shell.updateComplete;
  const next = view();
  next.departments.push({
    id: "new",
    name: "Brunch",
    tradingName: "",
    active: true,
  });
  release(next);
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1");
});
it("recovering a read clears only its load error and retains an Enable refusal", async () => {
  const { shell, failRead, failWrite } = await mount();
  failRead(new Error("offline"));
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  emit(list, "enable-department", { departmentId: "d2" });
  await expect.poll(() => alert(shell)).toBe("The venue configuration could not be loaded.");
  failWrite(new Error("refused"));
  emit(list, "enable-department", { departmentId: "d2" });
  await expect.poll(() => alert(shell)).toBe("The change could not be saved.");
  const recovered = view();
  recovered.departments[0]!.name = "Read recovered";
  shell.model = recovered;
  await shell.updateComplete;
  expect(alert(shell)).toBe("The change could not be saved.");
});
it("Enable sends one request while its first request is pending", async () => {
  const { shell } = await mount();
  let release!: () => void;
  const write = vi.spyOn(shell.api, "updateDepartment").mockImplementation(
    () =>
      new Promise<void>((yes) => {
        release = yes;
      }),
  );
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  emit(list, "enable-department", { departmentId: "d2" });
  emit(list, "enable-department", { departmentId: "d2" });
  await shell.updateComplete;
  expect(write).toHaveBeenCalledExactlyOnceWith("d2", { active: true });
  expect(shell.getAttribute("aria-busy")).toBe("true");
  release();
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
});
it("an Enable response from a previous connection cannot refresh a reconnected shell", async () => {
  const { shell, request } = await mount();
  let release!: () => void;
  vi.spyOn(shell.api, "updateDepartment").mockImplementation(
    () =>
      new Promise<void>((yes) => {
        release = yes;
      }),
  );
  emit(shell.shadowRoot!.querySelector("departments-list")!, "enable-department", {
    departmentId: "d2",
  });
  await shell.updateComplete;
  shell.remove();
  document.body.append(shell);
  await shell.updateComplete;
  release();
  await shell.updateComplete;
  expect(
    request.mock.calls.filter((call) => call[0] === "/management-api/venue-service"),
  ).toHaveLength(0);
  expect(shell.model.departments[1]!.active).toBe(false);
});
it("a delivered recovery snapshot clears an earlier load failure", async () => {
  const { shell, failRead } = await mount();
  failRead(new Error("offline"));
  emit(shell.shadowRoot!.querySelector("departments-list")!, "enable-department", {
    departmentId: "d2",
  });
  await expect.poll(() => alert(shell)).toBe("The venue configuration could not be loaded.");
  shell.model = view();
  await shell.updateComplete;
  expect(alert(shell)).toBe("");
});

it.each(["cancel", "save"] as const)(
  "closing with %s returns focus to Add when the edited department disappears",
  async (ending) => {
    const { shell, loaded, request } = await mount();
    const list = shell.shadowRoot!.querySelector("departments-list")!;
    await list.updateComplete;
    const table = list.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>("[data-test=rename-department-d1]")!.click();
    const el = await dialogs(shell);
    const next = view();
    next.departments = next.departments.filter((row) => row.id !== "d1");
    shell.model = next;
    loaded(next);
    await shell.updateComplete;
    await list.updateComplete;
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector("[data-test=rename-department-d1]")).toBeNull();
    if (ending === "save") await saveName(el, "Retained name");
    else el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
    await expect.poll(() => el.dialog).toBeUndefined();
    await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
    await expect
      .poll(() => list.shadowRoot!.activeElement)
      .toBe(list.shadowRoot!.querySelector("[data-test=add-department]"));
    if (ending === "cancel") expect(request).not.toHaveBeenCalled();
  },
);

it("a saved rename returns focus to the same row menu after refresh", async () => {
  const { shell, loaded } = await mount();
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const action = table.shadowRoot!.querySelector<HTMLElement>("[data-test=rename-department-d1]")!;
  action.click();
  const el = await dialogs(shell);
  const next = view();
  next.departments[0]!.name = "Brunch";
  loaded(next);
  await saveName(el, "Brunch");
  await expect.poll(() => shell.model.departments[0]!.name).toBe("Brunch");
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
  await list.updateComplete;
  await table.updateComplete;
  const menu = table
    .shadowRoot!.querySelector("[data-test=rename-department-d1]")!
    .closest("wt-row-actions")!;
  expect(menu.getAttribute("label")).toBe("Brunch: Actions");
  await expect
    .poll(() => menu.shadowRoot!.activeElement)
    .toBe(menu.shadowRoot!.querySelector("button"));
});

it("Cancel returns focus to Add zone when the edited zone disappears", async () => {
  const { shell, request } = await mount(
    "/manage/venue-operations/department/d1/view/zones/zone/z1",
  );
  const zones = shell.shadowRoot!.querySelector("department-zones")!;
  await zones.updateComplete;
  zones.shadowRoot!.querySelector<HTMLElement>("[data-test=rename-zone]")!.click();
  const el = await dialogs(shell);
  const next = view();
  next.zones = [];
  next.floorZones = [];
  shell.model = next;
  await shell.updateComplete;
  await zones.updateComplete;
  expect(zones.shadowRoot!.querySelector("[data-test=rename-zone]")).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => el.dialog).toBeUndefined();
  await expect
    .poll(() => zones.shadowRoot!.activeElement)
    .toBe(zones.shadowRoot!.querySelector("[data-test=add-zone]"));
  expect(request).not.toHaveBeenCalled();
});

it("Cancel returns focus to the parent link when the zone's department disappears", async () => {
  const { shell, request } = await mount(
    "/manage/venue-operations/department/d1/view/zones/zone/z1",
  );
  const zones = shell.shadowRoot!.querySelector("department-zones")!;
  await zones.updateComplete;
  zones.shadowRoot!.querySelector<HTMLElement>("[data-test=rename-zone]")!.click();
  const el = await dialogs(shell);
  const next = view();
  next.departments = next.departments.filter((row) => row.id !== "d1");
  shell.model = next;
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector("department-page")).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => el.dialog).toBeUndefined();
  const parent = shell.shadowRoot!.querySelector<HTMLAnchorElement>("nav a")!;
  expect(parent.getAttribute("href")).toBe("/manage/venue-operations");
  await expect.poll(() => shell.shadowRoot!.activeElement).toBe(parent);
  expect(request).not.toHaveBeenCalled();
});

it("Cancel returns focus to Add zone when the row menu is reused for a different zone", async () => {
  const { shell, request } = await mount(
    "/manage/venue-operations/department/d1/view/zones/zone/z1",
  );
  const zones = shell.shadowRoot!.querySelector("department-zones")!;
  await zones.updateComplete;
  const action = zones.shadowRoot!.querySelector<HTMLElement>("[data-test=rename-zone]")!;
  const trigger = action.closest("wt-row-actions")!.shadowRoot!.querySelector("button")!;
  action.click();
  const el = await dialogs(shell);
  const next = view();
  next.zones = next.zones.filter((row) => row.id !== "z1");
  next.floorZones = next.floorZones.filter((row) => row.id !== "z1");
  shell.model = next;
  await shell.updateComplete;
  await zones.updateComplete;
  expect(trigger.isConnected).toBe(true);
  expect(zones.shadowRoot!.querySelector("h2")!.textContent).toBe("z2");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => el.dialog).toBeUndefined();
  const add =
    zones.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=add-zone]")!;
  await expect.poll(() => zones.shadowRoot!.activeElement).toBe(add);
  expect(add.shadowRoot!.activeElement).toBe(add.shadowRoot!.querySelector("button"));
  expect(request).not.toHaveBeenCalled();
});

it.each(["success", "failure"] as const)(
  "a retained newer dialog draft survives the successful write's %s refresh",
  async (outcome) => {
    let finish!: () => void;
    const write = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { shell, request, loaded, failRead } = await mount(
      "/manage/venue-operations/department/d1",
      view(),
      write,
    );
    emit(shell.shadowRoot!.querySelector("department-page")!, "rename-department", {
      departmentId: "d1",
    });
    const el = await dialogs(shell);
    await saveName(el, "Submitted");
    await expect
      .poll(() => request.mock.calls.filter((call) => call[1] === "PATCH").length)
      .toBe(1);
    const box = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    await box.updateComplete;
    await userEvent.fill(page.elementLocator(box.shadowRoot!.querySelector("input")!), "Newer");
    const next = view();
    next.departments[0]!.name = "Submitted";
    loaded(next);
    if (outcome === "failure") failRead(new Error("offline"));
    finish();
    await expect
      .poll(
        () =>
          request.mock.calls.filter((call) => call[0] === "/management-api/venue-service").length,
      )
      .toBe(1);
    await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
    expect(el.dialog?.kind).toBe("rename-department");
    expect(box.value).toBe("Newer");
    expect(box.isConnected).toBe(true);
    expect(location.pathname).toBe("/manage/venue-operations/department/d1");
    expect(request).toHaveBeenCalledWith("/management-api/venue-service", "GET", undefined, {
      passive: true,
    });
    if (outcome === "success") {
      expect(shell.model.departments[0]!.name).toBe("Submitted");
      expect(alert(shell)).toBe("");
    } else {
      expect(alert(shell)).toBe("The venue configuration could not be loaded.");
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    }
    expect(request.mock.calls.filter((call) => call[1] === "PATCH")).toEqual([
      ["/management-api/venue-service/departments/d1", "PATCH", { name: "Submitted" }],
    ]);
  },
);

it("a retained dialog cannot write again while its successful write is refreshing", async () => {
  let finishWrite!: () => void, finishRead!: () => void;
  const write = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  const read = new Promise<void>((resolve) => {
    finishRead = resolve;
  });
  const { shell, request, loaded } = await mount(
    "/manage/venue-operations/department/d1",
    view(),
    write,
    read,
  );
  emit(shell.shadowRoot!.querySelector("department-page")!, "rename-department", {
    departmentId: "d1",
  });
  const el = await dialogs(shell);
  await saveName(el, "Submitted");
  await expect.poll(() => request.mock.calls.filter((call) => call[1] === "PATCH").length).toBe(1);
  const box = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  await box.updateComplete;
  await userEvent.fill(page.elementLocator(box.shadowRoot!.querySelector("input")!), "Newer");
  finishWrite();
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("true");
  const save =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!;
  await expect.poll(() => save.disabled).toBe(true);
  await save.updateComplete;
  expect(save.shadowRoot!.querySelector("button")!.disabled).toBe(true);
  save.click();
  await el.updateComplete;
  expect(request.mock.calls.filter((call) => call[1] === "PATCH")).toHaveLength(1);
  const next = view();
  next.departments[0]!.name = "Submitted";
  loaded(next);
  finishRead();
  await expect.poll(() => save.disabled).toBe(false);
  expect(box.value).toBe("Newer");
  next.departments[0]!.name = "Newer";
  loaded(next);
  save.click();
  await expect.poll(() => el.dialog).toBeUndefined();
  await expect.poll(() => shell.model.departments[0]!.name).toBe("Newer");
  expect(request.mock.calls.filter((call) => call[1] === "PATCH")).toHaveLength(2);
});

it.each([
  ["en", "Enable", "Disabled", "The change could not be saved."],
  ["es", "Habilitar", "Deshabilitada", "No se pudo guardar el cambio."],
] as const)(
  "a refused zone Enable stays available and its retry updates that zone in %s",
  async (locale, enableLabel, disabledLabel, refusal) => {
    const initial = view();
    initial.zones[0]!.active = false;
    initial.floorZones[0]!.active = false;
    setLocale(locale);
    const { shell, request, failWrite, loaded } = await mount(
      "/manage/venue-operations/department/d1/view/zones/zone/z1",
      initial,
    );
    setLocale(locale);
    shell.requestUpdate();
    await shell.updateComplete;
    const zones = shell.shadowRoot!.querySelector("department-zones")!;
    await zones.updateComplete;
    const enable =
      zones.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        "[data-test=enable-zone]",
      )!;
    expect(enable.textContent?.trim()).toBe(enableLabel);
    expect(zones.shadowRoot!.querySelector("[data-test=zone-z1]")!.textContent).toContain(
      disabledLabel,
    );
    failWrite({ code: "connection.failed" });
    enable.click();
    await expect.poll(() => alert(shell)).toBe(refusal);
    expect(request.mock.calls).toEqual([["/management-api/zones/z1", "PATCH", { active: true }]]);
    expect(shell.model.zones[0]!.active).toBe(false);
    expect(shell.shadowRoot!.querySelector("department-dialogs")?.dialog).toBeUndefined();
    expect(zones.shadowRoot!.querySelector("[data-test=enable-zone]")).not.toBeNull();
    expect(zones.shadowRoot!.querySelector("[data-test=disable-zone]")).toBeNull();

    const next = structuredClone(initial);
    next.zones[0]!.active = true;
    next.floorZones[0]!.active = true;
    loaded(next);
    failWrite(undefined);
    enable.click();
    await expect.poll(() => shell.model.zones[0]!.active).toBe(true);
    await zones.updateComplete;
    expect(zones.shadowRoot!.querySelector("[data-test=zone-z1]")!.textContent).not.toContain(
      disabledLabel,
    );
    expect(zones.shadowRoot!.querySelector("[data-test=enable-zone]")).toBeNull();
    expect(zones.shadowRoot!.querySelector("[data-test=disable-zone]")).not.toBeNull();
    expect(alert(shell)).toBe("");
    expect(request.mock.calls.filter((call) => call[1] === "PATCH")).toEqual([
      ["/management-api/zones/z1", "PATCH", { active: true }],
      ["/management-api/zones/z1", "PATCH", { active: true }],
    ]);
  },
);

it.each([
  [
    "en",
    "That zone needs an active department. Enable its department or assign it to an active one first",
  ],
  [
    "es",
    "Esa zona necesita un departamento habilitado. Habilita su departamento o asígnala primero a uno habilitado",
  ],
] as const)("a zone Enable department refusal keeps its control in %s", async (locale, refusal) => {
  const initial = view();
  initial.zones[0]!.active = false;
  initial.floorZones[0]!.active = false;
  const { shell, request, failWrite } = await mount(
    "/manage/venue-operations/department/d1/view/zones/zone/z1",
    initial,
  );
  setLocale(locale);
  shell.requestUpdate();
  await shell.updateComplete;
  const zones = shell.shadowRoot!.querySelector("department-zones")!;
  await zones.updateComplete;
  failWrite({ code: "zone.department_inactive", params: { departmentId: "d1" } });
  zones.shadowRoot!.querySelector<HTMLElement>("[data-test=enable-zone]")!.click();
  await expect.poll(() => alert(shell)).toBe(refusal);
  expect(request.mock.calls).toEqual([["/management-api/zones/z1", "PATCH", { active: true }]]);
  expect(shell.model.zones[0]!.active).toBe(false);
  expect(zones.shadowRoot!.querySelector("[data-test=enable-zone]")).not.toBeNull();
  expect(zones.shadowRoot!.querySelector("[data-test=disable-zone]")).toBeNull();
});

it.each([
  ["en", "Enable", "Disabled", "The change could not be saved."],
  ["es", "Habilitar", "Deshabilitado", "No se pudo guardar el cambio."],
] as const)(
  "a refused department Enable keeps its page and Settings read-only until retry in %s",
  async (locale, enableLabel, disabledLabel, refusal) => {
    setLocale(locale);
    const { shell, request, failWrite, loaded } = await mount(
      "/manage/venue-operations/department/d2",
    );
    const departmentPage = shell.shadowRoot!.querySelector("department-page")!;
    await departmentPage.updateComplete;
    const settings = departmentPage.shadowRoot!.querySelector("department-settings")!;
    await settings.updateComplete;
    const name =
      settings.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    const enable = departmentPage.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=enable-department]",
    )!;
    expect(enable.textContent?.trim()).toBe(enableLabel);
    expect(
      departmentPage.shadowRoot!.querySelector("[data-test=department-status]")!.textContent,
    ).toContain(disabledLabel);
    expect(name.disabled).toBe(true);
    failWrite({ code: "connection.failed" });
    enable.click();
    await expect.poll(() => alert(shell)).toBe(refusal);
    expect(request.mock.calls).toEqual([
      ["/management-api/venue-service/departments/d2", "PATCH", { active: true }],
    ]);
    expect(shell.model.departments[1]!.active).toBe(false);
    expect(name.disabled).toBe(true);
    expect(
      departmentPage.shadowRoot!.querySelector("[data-test=enable-department]"),
    ).not.toBeNull();
    expect(shell.shadowRoot!.querySelector("department-dialogs")?.dialog).toBeUndefined();
    const next = view();
    next.departments[1]!.active = true;
    loaded(next);
    failWrite(undefined);
    enable.click();
    await expect.poll(() => shell.model.departments[1]!.active).toBe(true);
    await departmentPage.updateComplete;
    await settings.updateComplete;
    expect(departmentPage.shadowRoot!.querySelector("[data-test=enable-department]")).toBeNull();
    expect(departmentPage.shadowRoot!.querySelector("[data-test=department-status]")).toBeNull();
    expect(name.disabled).toBe(false);
    expect(alert(shell)).toBe("");
    expect(request.mock.calls.filter((call) => call[1] === "PATCH")).toEqual([
      ["/management-api/venue-service/departments/d2", "PATCH", { active: true }],
      ["/management-api/venue-service/departments/d2", "PATCH", { active: true }],
    ]);
  },
);

it("a reserved-name Enable refreshes the shell without accepting or navigating away from Rename", async () => {
  const { shell, request, loaded, failWrite } = await mount(
    "/manage/venue-operations/department/d1",
  );
  failWrite({ code: "department.name_disabled", params: { name: "Deli", departmentId: "d2" } });
  emit(shell.shadowRoot!.querySelector("department-page")!, "rename-department", {
    departmentId: "d1",
  });
  const editor = await dialogs(shell);
  await saveName(editor, "Deli");
  await expect
    .poll(() => editor.shadowRoot!.querySelector("[data-test=enable-name-clash]"))
    .not.toBeNull();
  const next = view();
  next.departments[1]!.active = true;
  loaded(next);
  failWrite(undefined);
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=enable-name-clash]")!.click();
  await expect.poll(() => shell.model.departments[1]!.active).toBe(true);
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
  expect(editor.dialog?.kind).toBe("rename-department");
  const field = editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  await field.updateComplete;
  expect(field.shadowRoot!.querySelector("input")!.value).toBe("Deli");
  expect(field.error).toBe("A department with this name already exists.");
  expect(editor.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!
      .disabled,
  ).toBe(false);
  expect(shell.model.departments[0]!.name).toBe("Restaurant");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1");
  expect(alert(shell)).toBe("");
  expect(request.mock.calls.filter((call) => call[1] === "PATCH")).toEqual([
    ["/management-api/venue-service/departments/d1", "PATCH", { name: "Deli" }],
    ["/management-api/venue-service/departments/d2", "PATCH", { active: true }],
  ]);
  expect(request).toHaveBeenCalledWith("/management-api/venue-service", "GET", undefined, {
    passive: true,
  });
});
