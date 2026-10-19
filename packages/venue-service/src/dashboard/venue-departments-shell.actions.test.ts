import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { page, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import { departmentHoursModel } from "../testing/department-hours-fixture.js";
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
    printMovedSlips: true,
    releaseReminderMinutes: null,
    needsClearingDepartmentIds: [],
    serviceSteps: [],
    courses: [],
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
    if (url === "/management-api/zones") return loaded.floorZones;
    if (url.endsWith("/profiles")) return [];
    if (url.endsWith("/delete-impact")) {
      const id = url.split("/").at(-2)!;
      return { target: { id, name: id }, refusals: [], ends: [], removes: [] };
    }
    return { departmentId: "d1", receivingProfileId: null, destinationDepartmentIds: [] };
  });
  shell.api = new VenueServiceApi(((...args: Parameters<DashboardRequest>) => {
    const [url, method] = args;
    if (url === "/management-api/venue-service/opening-hours" && method === "GET")
      return Promise.resolve(departmentHoursModel());
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
async function listTable(shell: HTMLElementTagNameMap["venue-departments-shell"]) {
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return { list, table };
}
async function departmentForm(shell: HTMLElementTagNameMap["venue-departments-shell"]) {
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).not.toBeNull();
  const editor = shell.shadowRoot!.querySelector("department-edit-dialog")!;
  await editor.updateComplete;
  const form = editor.shadowRoot!.querySelector("department-settings")!;
  await form.updateComplete;
  return form;
}
async function saveDepartmentName(
  form: HTMLElementTagNameMap["department-settings"],
  name: string,
) {
  emit(form.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: name });
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
}
function alert(shell: HTMLElementTagNameMap["venue-departments-shell"]) {
  return shell.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim() ?? "";
}
it.each([
  ["delete-department", { departmentId: "d1" }, "delete-department", "d1"],
  ["add-to-department", { zoneId: "z1" }, "add-to-department", "z1"],
  ["delete-zone", { zoneId: "z1" }, "delete-zone", "z1"],
] as const)("%s opens the dialog for its recorded row", async (event, detail, kind, id) => {
  const { shell } = await mount();
  emit(shell.shadowRoot!.querySelector("departments-list")!, event, detail);
  const el = await dialogs(shell);
  expect(el.dialog!.kind).toBe(kind);
  expect("row" in el.dialog! && el.dialog!.row.id).toBe(id);
});
it("Add zone uses the originating department row", async () => {
  const { shell } = await mount();
  const { table } = await listTable(shell);
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=add-zone-d1]")!.click();
  expect((await dialogs(shell)).dialog).toEqual({ kind: "add-zone", departmentId: "d1" });
});
it("unknown action ids do not open a dialog or write", async () => {
  const { shell, request } = await mount();
  emit(shell.shadowRoot!.querySelector("departments-list")!, "open-department", {
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

it("a moved zone closes its old department editor and stays in the list", async () => {
  const { shell } = await mount("/manage/venue-operations/department/d1/view/zones/zone/z1");
  const moved = view();
  moved.departments[1]!.active = true;
  moved.zones[0]!.departmentId = "d2";
  shell.model = moved;
  await shell.updateComplete;
  await expect.poll(() => shell.shadowRoot!.querySelector("zone-edit-dialog")).toBeNull();
  expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
  expect(location.pathname).toBe("/manage/venue-operations");
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
  emit(shell.shadowRoot!.querySelector("department-dialogs")!, "written", { departmentId: "d1" });
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

it("Cancel returns focus to the real Add zone row-menu trigger", async () => {
  const { shell } = await mount();
  const { table } = await listTable(shell);
  const action = table.shadowRoot!.querySelector<HTMLElement>("[data-test=add-zone-d1]")!;
  const menu = action.closest("wt-row-actions")!;
  await menu.updateComplete;
  const opener = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
  action.click();
  const el = await dialogs(shell);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => el.dialog).toBeUndefined();
  await expect.poll(() => menu.shadowRoot!.activeElement).toBe(opener);
});
it.each([0, 2])(
  "adding a zone returns focus to its department menu with %i prior zones",
  async (count) => {
    const model = view();
    model.zones = model.zones.slice(0, count);
    model.floorZones = model.floorZones.slice(0, count);
    const { shell, loaded, request } = await mount(undefined, model);
    const { table } = await listTable(shell);
    const action = table.shadowRoot!.querySelector<HTMLElement>("[data-test=add-zone-d1]")!;
    const menu = action.closest("wt-row-actions")!;
    await menu.updateComplete;
    const opener = menu.shadowRoot!.querySelector("button")!;
    const next = structuredClone(model);
    next.zones.push({ ...view().zones[0]!, id: "new", name: "Garden" });
    next.floorZones.push({ id: "new", name: "Garden", active: true });
    loaded(next);
    action.click();
    const el = await dialogs(shell);
    await saveName(el, "Garden");
    await expect.poll(() => el.dialog).toBeUndefined();
    await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
    expect(location.pathname).toBe("/manage/venue-operations");
    expect(shell.model.zones.find((row) => row.id === "new")!.name).toBe("Garden");
    expect(request.mock.calls.filter((call) => call[1] === "POST")).toEqual([
      ["/management-api/venue-service/zones", "POST", { name: "Garden", departmentId: "d1" }],
    ]);
    await expect.poll(() => menu.shadowRoot!.activeElement).toBe(opener);
  },
);
it.each(["cancel", "save"] as const)(
  "department Edit %s restores the originating row-menu trigger",
  async (ending) => {
    const { shell } = await mount();
    const { table } = await listTable(shell);
    const action = table.shadowRoot!.querySelector<HTMLElement>("[data-test=open-department-d1]")!;
    const menu = action.closest("wt-row-actions")!;
    await menu.updateComplete;
    const trigger = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    await userEvent.click(page.elementLocator(trigger));
    await userEvent.click(page.elementLocator(action));
    const form = await departmentForm(shell);
    if (ending === "save") await saveDepartmentName(form, "New name");
    else form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
    await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).toBeNull();
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
  emit(shell.shadowRoot!.querySelector("department-dialogs")!, "written", { departmentId: "d1" });
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

it("a delivered recovery snapshot clears an earlier load failure", async () => {
  const { shell, failRead } = await mount();
  failRead(new Error("offline"));
  emit(shell.shadowRoot!.querySelector("department-dialogs")!, "written", { departmentId: "d1" });
  await expect.poll(() => alert(shell)).toBe("The venue configuration could not be loaded.");
  shell.model = view();
  await shell.updateComplete;
  expect(alert(shell)).toBe("");
});

it.each(["department", "zone"] as const)(
  "a removed %s editor returns to Add without writing",
  async (kind) => {
    const { shell, request } = await mount();
    const { list, table } = await listTable(shell);
    table
      .shadowRoot!.querySelector<HTMLElement>(
        `[data-test=${kind === "department" ? "open-department-d1" : "edit-zone-z1"}]`,
      )!
      .click();
    await expect.poll(() => shell.shadowRoot!.querySelector(`${kind}-edit-dialog`)).not.toBeNull();
    const next = view();
    if (kind === "department") next.departments = next.departments.filter((row) => row.id !== "d1");
    else {
      next.zones = [];
      next.floorZones = [];
    }
    shell.model = next;
    await expect.poll(() => shell.shadowRoot!.querySelector(`${kind}-edit-dialog`)).toBeNull();
    await expect
      .poll(() => list.shadowRoot!.activeElement)
      .toBe(list.shadowRoot!.querySelector("[data-test=add-department]"));
    expect(location.pathname).toBe("/manage/venue-operations");
    expect(request.mock.calls.filter(([, method]) => method !== "GET")).toEqual([]);
  },
);
it("a saved department edit returns focus to the same row menu after refresh", async () => {
  const { shell, loaded } = await mount();
  const { table } = await listTable(shell);
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=open-department-d1]")!.click();
  const form = await departmentForm(shell);
  const next = view();
  next.departments[0]!.name = "Brunch";
  loaded(next);
  await saveDepartmentName(form, "Brunch");
  await expect.poll(() => shell.model.departments[0]!.name).toBe("Brunch");
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
  await table.updateComplete;
  const menu = table
    .shadowRoot!.querySelector("[data-test=open-department-d1]")!
    .closest("wt-row-actions")!;
  expect(menu.getAttribute("label")).toBe("Brunch: Actions");
  await expect
    .poll(() => menu.shadowRoot!.activeElement)
    .toBe(menu.shadowRoot!.querySelector("button"));
});
it("removing a zone's department closes its editor and returns to Add", async () => {
  const { shell, request } = await mount(
    "/manage/venue-operations/department/d1/view/zones/zone/z1",
  );
  const { list } = await listTable(shell);
  const next = view();
  next.departments = next.departments.filter((row) => row.id !== "d1");
  shell.model = next;
  await expect.poll(() => shell.shadowRoot!.querySelector("zone-edit-dialog")).toBeNull();
  await expect
    .poll(() => list.shadowRoot!.activeElement)
    .toBe(list.shadowRoot!.querySelector("[data-test=add-department]"));
  expect(request.mock.calls.filter(([, method]) => method !== "GET")).toEqual([]);
});
it("closing a zone editor never focuses a row menu reused for another identity", async () => {
  const { shell } = await mount();
  const { list, table } = await listTable(shell);
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-zone-z1]")!.click();
  await expect.poll(() => shell.shadowRoot!.querySelector("zone-edit-dialog")).not.toBeNull();
  const next = view();
  next.zones = next.zones.filter((row) => row.id !== "z1");
  next.floorZones = next.floorZones.filter((row) => row.id !== "z1");
  shell.model = next;
  await expect.poll(() => shell.shadowRoot!.querySelector("zone-edit-dialog")).toBeNull();
  await expect
    .poll(() => list.shadowRoot!.activeElement)
    .toBe(list.shadowRoot!.querySelector("[data-test=add-department]"));
  expect(table.shadowRoot!.querySelector("[data-test=edit-zone-z1]")).toBeNull();
  expect(table.shadowRoot!.querySelector("[data-test=edit-zone-z2]")).not.toBeNull();
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
    emit(shell.shadowRoot!.querySelector("departments-list")!, "open-department", {
      departmentId: "d1",
    });
    const el = await departmentForm(shell);
    await saveDepartmentName(el, "Submitted");
    await expect.poll(() => request.mock.calls.filter((call) => call[1] === "PUT").length).toBe(1);
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
    expect(shell.shadowRoot!.querySelector("department-edit-dialog")?.departmentId).toBe("d1");
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
    expect(request.mock.calls.filter((call) => call[1] === "PUT")).toEqual([
      [
        "/management-api/venue-service/departments/d1/settings",
        "PUT",
        {
          name: "Submitted",
          tradingName: "Casa",
          orderStart: "counter",
          paidWhen: "prepay",
          collectionNumber: "none",
          needsClearing: false,
        },
      ],
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
  emit(shell.shadowRoot!.querySelector("departments-list")!, "open-department", {
    departmentId: "d1",
  });
  const el = await departmentForm(shell);
  await saveDepartmentName(el, "Submitted");
  await expect.poll(() => request.mock.calls.filter((call) => call[1] === "PUT").length).toBe(1);
  const box = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  await box.updateComplete;
  await userEvent.fill(page.elementLocator(box.shadowRoot!.querySelector("input")!), "Newer");
  finishWrite();
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("true");
  const save =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!;
  await expect.poll(() => save.disabled).toBe(true);
  expect(save.variant).toBe("secondary");
  await save.updateComplete;
  expect(save.shadowRoot!.querySelector("button")!.disabled).toBe(true);
  save.click();
  await el.updateComplete;
  expect(request.mock.calls.filter((call) => call[1] === "PUT")).toHaveLength(1);
  const next = view();
  next.departments[0]!.name = "Submitted";
  loaded(next);
  finishRead();
  await expect.poll(() => save.disabled).toBe(false);
  expect(save.variant).toBe("primary");
  expect(box.value).toBe("Newer");
  next.departments[0]!.name = "Newer";
  loaded(next);
  save.click();
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).toBeNull();
  await expect.poll(() => shell.model.departments[0]!.name).toBe("Newer");
  expect(request.mock.calls.filter((call) => call[1] === "PUT")).toHaveLength(2);
});

it("a retained zone draft cannot save twice while its first write is refreshing", async () => {
  let finishWrite!: () => void, finishRead!: () => void;
  const write = new Promise<void>((yes) => {
    finishWrite = yes;
  });
  const read = new Promise<void>((yes) => {
    finishRead = yes;
  });
  const { shell, loaded, request } = await mount(
    "/manage/venue-operations/department/d1/view/zones/zone/z1",
    view(),
    write,
    read,
  );
  const editor = shell.shadowRoot!.querySelector("zone-edit-dialog")!;
  await editor.updateComplete;
  const field = editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), "Submitted");
  await editor.updateComplete;
  const save =
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-editor]",
    )!;
  save.click();
  await expect
    .poll(() => request.mock.calls.filter(([, method]) => method === "PUT").length)
    .toBe(1);
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), "Newer");
  finishWrite();
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("true");
  await expect.poll(() => save.disabled).toBe(true);
  expect(save.variant).toBe("secondary");
  save.click();
  await editor.updateComplete;
  expect(request.mock.calls.filter(([, method]) => method === "PUT")).toEqual([
    [
      "/management-api/venue-service/zones/z1/settings",
      "PUT",
      {
        name: "Submitted",
        orderStart: null,
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
      },
    ],
  ]);
  const next = view();
  next.zones[0]!.name = "Submitted";
  loaded(next);
  finishRead();
  await expect.poll(() => save.disabled).toBe(false);
  expect(save.variant).toBe("primary");
  expect(field.value).toBe("Newer");
  expect(field.isConnected).toBe(true);
});
