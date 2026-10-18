import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { html } from "lit";
import { applyTokens, NavigationGuard } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import { selectDepartmentTab } from "../testing/department-edit-fixture.js";
import "./venue-departments-shell.js";
const initial = location.href;
const shells: HTMLElementTagNameMap["venue-departments-shell"][] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const shell of shells.splice(0)) shell.remove();
  history.replaceState(null, "", initial);
  setLocale("en");
});
async function mount(
  path = "/manage/venue-operations",
  request?: DashboardRequest,
  model = structuredClone(zonesModel),
) {
  setLocale("en");
  history.replaceState(null, "", `${path}?source=saved`);
  const shell = document.createElement("venue-departments-shell");
  applyTokens(shell);
  shell.model = model;
  shell.api = new VenueServiceApi(
    request ??
      ((async (path) =>
        path.includes("profiles")
          ? []
          : path.includes("transfers")
            ? { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] }
            : { tables: [] }) as DashboardRequest),
  );
  shell.renderPanel = (_panel, subject) => html`<p data-test="receipt-panel">${subject?.id}</p>`;
  shells.push(shell);
  document.body.append(shell);
  await shell.updateComplete;
  return shell;
}
function emit(shell: HTMLElement, type: string, detail: object) {
  shell
    .shadowRoot!.querySelector("departments-list")!
    .dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
it.each([
  "",
  "/department/d1",
  "/department/d1/view/zones/zone/z1",
  "/department/d1/view/receipt",
  "/department/gone",
])("list remains visible under the deep link %s without department pages", async (suffix) => {
  const shell = await mount(`/manage/venue-operations${suffix}`);
  expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
  expect(shell.shadowRoot!.querySelector("department-page")).toBeNull();
  expect(shell.shadowRoot!.querySelector("department-zones")).toBeNull();
  if (suffix.endsWith("receipt"))
    expect(
      (await departmentSettings(shell)).shadowRoot!.querySelector("[data-test=receipt-panel]")!
        .textContent,
    ).toBe("d1");
  else if (suffix.includes("/zone/"))
    expect(shell.shadowRoot!.querySelector("zone-edit-dialog")!.zoneId).toBe("z1");
  else if (suffix === "/department/d1")
    expect(shell.shadowRoot!.querySelector("department-edit-dialog")!.departmentId).toBe("d1");
  expect(location.search).toBe("?source=saved");
});
it("row actions open protected editors and receipt content while preserving the list", async () => {
  const shell = await mount();
  emit(shell, "open-department", { departmentId: "d2" });
  await expect
    .poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")?.departmentId)
    .toBe("d2");
  history.replaceState(null, "", "/manage/venue-operations?source=saved");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await shell.updateComplete;
  emit(shell, "edit-zone", { zoneId: "z1" });
  await expect.poll(() => shell.shadowRoot!.querySelector("zone-edit-dialog")?.zoneId).toBe("z1");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1/view/zones/zone/z1");
});
it("Add zone takes the row's department rather than the address", async () => {
  const shell = await mount();
  emit(shell, "add-zone", { departmentId: "d2" });
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector("department-dialogs")!.dialog).toEqual({
    kind: "add-zone",
    departmentId: "d2",
  });
});
it("a deleted editor identity closes while its list remains visible", async () => {
  const shell = await mount("/manage/venue-operations/department/d1/view/zones/zone/z1");
  shell.model = { ...shell.model, zones: shell.model.zones.filter((row) => row.id !== "z1") };
  await shell.updateComplete;
  await expect.poll(() => shell.shadowRoot!.querySelector("zone-edit-dialog")).toBeNull();
  expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
});
it("a successful editor write followed by a failed refresh closes and reports only a load failure", async () => {
  const shell = await mount("/manage/venue-operations/department/d1", (async (path) => {
    if (path === "/management-api/venue-service") throw { code: "server.internal" };
    return path.includes("profiles")
      ? []
      : { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
  }) as DashboardRequest);
  const editor = shell.shadowRoot!.querySelector("department-edit-dialog")!;
  expect(editor, "the row editor is open").not.toBeNull();
  editor.dispatchEvent(
    new CustomEvent("saved", { detail: { departmentId: "d1" }, bubbles: true, composed: true }),
  );
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).toBeNull();
  await expect
    .poll(() => shell.shadowRoot!.querySelector('[role="alert"]')?.textContent)
    .toBe("The venue configuration could not be loaded.");
  expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
});
it("a keyboard move refreshes the assignment and returns focus to the moved zone grip", async () => {
  const next = structuredClone(zonesModel);
  next.zones[0]!.departmentId = "d2";
  let finish!: () => void;
  const shell = await mount(undefined, (async (path, method = "GET") => {
    if (method !== "GET") return undefined;
    if (path === "/management-api/zones") return next.floorZones;
    if (path === "/management-api/venue-service") {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return next;
    }
    return { tables: [] };
  }) as DashboardRequest);
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-test="zone-grip-z1"]')!.focus();
  await userEvent.keyboard(" ");
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("true");
  finish();
  await expect.poll(() => shell.model.zones[0]!.departmentId).toBe("d2");
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
  await expect
    .poll(() => table.shadowRoot!.activeElement)
    .toBe(table.shadowRoot!.querySelector('[data-test="zone-grip-z1"]'));
});
it("a second completed move queues another refresh while the first read is pending", async () => {
  let reads = 0;
  let finish!: () => void;
  const shell = await mount(undefined, (async (path) => {
    if (path === "/management-api/zones") return [];
    if (path !== "/management-api/venue-service") return { tables: [] };
    reads++;
    if (reads === 1)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return structuredClone(zonesModel);
  }) as DashboardRequest);
  emit(shell, "zone-moved", { zoneId: "z1" });
  await expect.poll(() => reads).toBe(1);
  emit(shell, "zone-moved", { zoneId: "z2" });
  finish();
  await expect.poll(() => reads).toBe(2);
  await expect.poll(() => shell.getAttribute("aria-busy")).toBe("false");
});

function oneDepartment() {
  const model = structuredClone(zonesModel);
  model.departments = model.departments.map((row) =>
    row.id === "d1" ? row : { ...row, active: false },
  );
  return model;
}
async function departmentSettings(shell: HTMLElementTagNameMap["venue-departments-shell"]) {
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).not.toBeNull();
  const editor = shell.shadowRoot!.querySelector("department-edit-dialog")!;
  await editor.updateComplete;
  const form = editor.shadowRoot!.querySelector("department-settings")!;
  await form.updateComplete;
  return form;
}
function written(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map(([, , url]) => new URL(String(url), location.href).pathname);
}
it("choosing the Service tab records /view/service and Back returns to Details", async () => {
  const shell = await mount("/manage/venue-operations/department/d1");
  const form = await departmentSettings(shell);
  await selectDepartmentTab(form, "service");
  await expect
    .poll(() => location.pathname)
    .toBe("/manage/venue-operations/department/d1/view/service");
  expect(location.search).toBe("?source=saved");
  history.back();
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations/department/d1");
  await expect.poll(() => form.tab).toBe("details");
  expect(form.isConnected).toBe(true);
});
it("a tab change whose address write does not land puts the form back on the address's tab", async () => {
  const shell = await mount("/manage/venue-operations/department/d1");
  const form = await departmentSettings(shell);
  let answer!: (outcome: "kept") => void;
  const guard = new NavigationGuard(window, {
    isDirty: () => true,
    request: () => new Promise((resolve) => (answer = resolve)),
  });
  const elsewhere = guard.write("/manage/products?source=saved");
  try {
    await selectDepartmentTab(form, "service");
    await expect.poll(() => form.tab).toBe("details");
    expect(location.pathname).toBe("/manage/venue-operations/department/d1");
  } finally {
    answer("kept");
    await elsewhere;
    guard.dispose();
  }
});
it("/manage/venue-operations/department/d1/view/service opens the dialog on Service", async () => {
  const shell = await mount("/manage/venue-operations/department/d1/view/service");
  const form = await departmentSettings(shell);
  expect(form.tab).toBe("service");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1/view/service");
});
it("an address naming Transfers with one department opens Details and replaces the address", async () => {
  const replace = vi.spyOn(history, "replaceState");
  const push = vi.spyOn(history, "pushState");
  const shell = await mount(
    "/manage/venue-operations/department/d1/view/transfers",
    undefined,
    oneDepartment(),
  );
  const form = await departmentSettings(shell);
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations/department/d1");
  expect(form.tab).toBe("details");
  expect(written(replace)).toContain("/manage/venue-operations/department/d1");
  expect(push).not.toHaveBeenCalled();
});
it.each(["unknown", "details"])(
  "an address naming the unrecognised view %s opens Details and replaces the address",
  async (view) => {
    const replace = vi.spyOn(history, "replaceState");
    const push = vi.spyOn(history, "pushState");
    const shell = await mount(`/manage/venue-operations/department/d1/view/${view}`);
    const form = await departmentSettings(shell);
    await expect.poll(() => location.pathname).toBe("/manage/venue-operations/department/d1");
    expect(form.tab).toBe("details");
    expect(written(replace)).toContain("/manage/venue-operations/department/d1");
    expect(push).not.toHaveBeenCalled();
  },
);
it("moving from Details to an unrecognised view replaces the address with Details", async () => {
  const shell = await mount("/manage/venue-operations/department/d1");
  const form = await departmentSettings(shell);
  history.pushState(null, "", "/manage/venue-operations/department/d1/view/missing?source=saved");
  const replace = vi.spyOn(history, "replaceState");
  const push = vi.spyOn(history, "pushState");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations/department/d1");
  expect(form.tab).toBe("details");
  expect(written(replace)).toEqual(["/manage/venue-operations/department/d1"]);
  expect(push).not.toHaveBeenCalled();
});
it("when Transfers stops being offered the address returns to Details by replacement", async () => {
  const shell = await mount("/manage/venue-operations/department/d1/view/transfers");
  const form = await departmentSettings(shell);
  expect(form.tab).toBe("transfers");
  const replace = vi.spyOn(history, "replaceState");
  const push = vi.spyOn(history, "pushState");
  shell.model = oneDepartment();
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations/department/d1");
  await shell.updateComplete;
  expect(form.tab).toBe("details");
  expect(written(replace)).toEqual(["/manage/venue-operations/department/d1"]);
  expect(push).not.toHaveBeenCalled();
});
it("while the replacement for an unoffered tab is in flight, further updates write nothing more", async () => {
  const shell = await mount("/manage/venue-operations/department/d1/view/transfers");
  const form = await departmentSettings(shell);
  expect(form.tab).toBe("transfers");
  let answer!: (outcome: "proceeded") => void;
  const guard = new NavigationGuard(window, {
    isDirty: () => true,
    request: (proceed) =>
      new Promise(
        (resolve) =>
          (answer = (outcome) => void Promise.resolve(proceed()).then(() => resolve(outcome))),
      ),
  });
  const write = vi.spyOn(guard, "write");
  try {
    shell.model = oneDepartment();
    await shell.updateComplete;
    await expect.poll(() => write.mock.calls.length).toBe(1);
    for (let i = 0; i < 3; i++) {
      shell.requestUpdate();
      await shell.updateComplete;
    }
    expect(write).toHaveBeenCalledTimes(1);
    answer("proceeded");
    await expect.poll(() => location.pathname).toBe("/manage/venue-operations/department/d1");
    await shell.updateComplete;
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    guard.dispose();
  }
});
it("closing from the Service tab returns focus to that row's menu", async () => {
  const shell = await mount();
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=open-department-d1]")!.click();
  const form = await departmentSettings(shell);
  await selectDepartmentTab(form, "service");
  await expect
    .poll(() => location.pathname)
    .toBe("/manage/venue-operations/department/d1/view/service");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).toBeNull();
  const menu = table
    .shadowRoot!.querySelector("[data-test=open-department-d1]")!
    .closest("wt-row-actions")!;
  await expect
    .poll(() => menu.shadowRoot!.activeElement)
    .toBe(menu.shadowRoot!.querySelector("button"));
});
it("the list's tax-agency description button opens the department dialog on Receipts", async () => {
  const model = structuredClone(zonesModel);
  model.readiness.push({
    code: "department.operation_description_required",
    departmentId: "d2",
    departmentName: "Deli",
  } as (typeof model.readiness)[number]);
  const shell = await mount("/manage/venue-operations", undefined, model);
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  await userEvent.click(
    table.shadowRoot!.querySelector<HTMLElement>("[data-test=receipt-setup-d2]")!,
  );
  const form = await departmentSettings(shell);
  expect(shell.shadowRoot!.querySelector("department-edit-dialog")!.departmentId).toBe("d2");
  await expect.poll(() => form.tab).toBe("receipt");
  expect(form.shadowRoot!.querySelector("[data-test=receipt-panel]")!.textContent).toBe("d2");
  expect(location.pathname).toBe("/manage/venue-operations/department/d2/view/receipt");
});
it("/view/receipt opens the department dialog on its Receipts tab", async () => {
  const shell = await mount("/manage/venue-operations/department/d1/view/receipt");
  const form = await departmentSettings(shell);
  expect(shell.shadowRoot!.querySelector("department-edit-dialog")!.departmentId).toBe("d1");
  expect(form.tab).toBe("receipt");
  expect(form.shadowRoot!.querySelector("[data-test=receipt-panel]")!.textContent).toBe("d1");
  const panels = (root: ShadowRoot): Element[] => [
    ...root.querySelectorAll("[data-test=receipt-panel]"),
    ...[...root.querySelectorAll("*")].flatMap((node) =>
      node.shadowRoot ? panels(node.shadowRoot) : [],
    ),
  ];
  expect(panels(shell.shadowRoot!)).toEqual([
    form.shadowRoot!.querySelector("[data-test=receipt-panel]"),
  ]);
  expect(location.pathname).toBe("/manage/venue-operations/department/d1/view/receipt");
});
it("navigationScopes is [] for another offered tab of the open department and undefined for another department, a zone or receipt", async () => {
  const at = (path: string) => new URL(path, location.origin);
  const list = await mount();
  expect(list.navigationScopes(at("/manage/venue-operations/department/d1?source=saved"))).toBe(
    undefined,
  );
  list.remove();
  const shell = await mount("/manage/venue-operations/department/d1/view/service");
  shell.renderPanel = undefined;
  await shell.updateComplete;
  await departmentSettings(shell);
  for (const path of [
    "/department/d1",
    "/department/d1/view/service",
    "/department/d1/view/transfers",
  ])
    expect(
      shell.navigationScopes(at(`/manage/venue-operations${path}?source=saved`)),
      path,
    ).toEqual([]);
  for (const path of [
    "/manage/venue-operations/department/d2?source=saved",
    "/manage/venue-operations/department/d1/view/zones/zone/z1?source=saved",
    "/manage/venue-operations/department/d1/view/receipt?source=saved",
    "/manage/venue-operations?source=saved",
    "/manage/venue-operations/department/d1/view/service",
    "/manage/venue-operations/department/d1/view/service?source=saved#x",
    "/manage/products?source=saved",
    "/manage/venue-operations/department/%E0%A4%A?source=saved",
    "/manage/venue-operations/department/d1/department/d1?source=saved",
    "/manage/venue-operations/department?source=saved",
    "/manage/venue-operations/department/d1/view/service/zone/z1?source=saved",
    "/manage/venue-operations/department/d1/view/zones?source=saved",
    "/other/venue-operations/department/d1?source=saved",
    "https://elsewhere.example/manage/venue-operations/department/d1?source=saved",
  ])
    expect(shell.navigationScopes(at(path)), path).toBe(undefined);
  shell.remove();
  const single = await mount("/manage/venue-operations/department/d1", undefined, oneDepartment());
  await departmentSettings(single);
  expect(
    single.navigationScopes(
      at("/manage/venue-operations/department/d1/view/transfers?source=saved"),
    ),
  ).toBe(undefined);
});
it("navigationScopes is [] for receipt when the dialog offers it", async () => {
  const at = (path: string) => new URL(path, location.origin);
  const shell = await mount("/manage/venue-operations/department/d1/view/service");
  shell.renderPanel = undefined;
  await shell.updateComplete;
  await departmentSettings(shell);
  const receipt = "/manage/venue-operations/department/d1/view/receipt?source=saved";
  expect(shell.navigationScopes(at(receipt))).toBe(undefined);
  shell.renderPanel = (_panel, subject) => html`<p data-test="receipt-panel">${subject?.id}</p>`;
  await shell.updateComplete;
  expect(shell.navigationScopes(at(receipt))).toEqual([]);
  expect(
    shell.navigationScopes(at("/manage/venue-operations/department/d2/view/receipt?source=saved")),
  ).toBe(undefined);
});
