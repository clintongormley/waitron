import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController, UrlStateController, navigationGuardFor } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import "./venue-departments-shell.js";

const initialUrl = location.href;
const model: VenueServiceView = {
  departments: [
    {
      id: "d1",
      name: "Restaurant",
      tradingName: "Casa",
      active: true,
    },
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
class App extends LitElement {
  readonly leave = new LeaveController(this);
  readonly url = new UrlStateController(this, () => {}, {
    basePath: "/manage",
    primary: "dashboard",
    children: {},
    leave: {
      isDirty: () => this.leave.coordinator.isDirty(),
      request: (proceed, signal) =>
        this.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    },
  });
  readonly api = new VenueServiceApi(
    vi.fn(async (path: string) =>
      path.endsWith("/profiles")
        ? []
        : { departmentId: "d1", receivingProfileId: null, destinationDepartmentIds: [] },
    ) as DashboardRequest,
  );
  override render() {
    return html`<venue-departments-shell .model=${model} .api=${this.api}></venue-departments-shell
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("a10-shell-leave-app", App);
let app: App;
afterEach(() => {
  app?.remove();
  vi.restoreAllMocks();
  history.replaceState(null, "", initialUrl);
  setLocale("en");
});
async function mount(path = "/manage/venue-operations/department/d1") {
  setLocale("en");
  history.replaceState(null, "", path);
  app = document.createElement("a10-shell-leave-app") as App;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const shell = app.shadowRoot!.querySelector("venue-departments-shell")!;
  await shell.updateComplete;
  const page = shell.shadowRoot!.querySelector("department-page");
  await page?.updateComplete;
  const settings = page?.shadowRoot!.querySelector("department-settings");
  await settings?.updateComplete;
  return { shell, page: page!, settings: settings! };
}
async function edit(settings: HTMLElementTagNameMap["department-settings"]) {
  settings
    .shadowRoot!.querySelector("[name=name]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Draft" }, bubbles: true, composed: true }),
    );
  await settings.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
}
async function choose(value: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${value}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}
it("the real tab click keeps an edited Settings page until Discard accepts the Zones URL", async () => {
  const { shell, page, settings } = await mount();
  await edit(settings);
  const tabs = page.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  const button = tabs.shadowRoot!.querySelector<HTMLElement>("[data-key=zones]")!;
  button.click();
  await choose("keep");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1");
  expect(
    (settings.shadowRoot!.querySelector("[name=name]")! as HTMLElementTagNameMap["wt-input"]).value,
  ).toBe("Draft");
  expect(tabs.value).toBe("settings");
  button.click();
  await choose("discard");
  await expect
    .poll(() => location.pathname)
    .toBe("/manage/venue-operations/department/d1/view/zones");
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector("department-page")!.view).toBe("zones");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("browser Back restores the edited page while Keep is chosen, then Discard returns to the list", async () => {
  const { shell, settings } = await mount("/manage/venue-operations");
  await navigationGuardFor(window)!.write("/manage/venue-operations/department/d1");
  await shell.updateComplete;
  const page = shell.shadowRoot!.querySelector("department-page")!;
  await page.updateComplete;
  const current = page.shadowRoot!.querySelector("department-settings")!;
  await current.updateComplete;
  await edit(current);
  const length = history.length;
  history.back();
  await choose("keep");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1");
  expect(shell.shadowRoot!.querySelector("department-page")).toBe(page);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(history.length).toBe(length);
  history.back();
  await choose("discard");
  await expect.poll(() => shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
  expect(location.pathname).toBe("/manage/venue-operations");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(history.length).toBe(length);
  expect(settings).toBeUndefined();
});
it("an accepted external department route recreates the form and its baseline", async () => {
  const { shell, settings } = await mount();
  await edit(settings);
  const pending = navigationGuardFor(window)!.write("/manage/venue-operations/department/gone");
  await choose("keep");
  await pending;
  expect(shell.shadowRoot!.querySelector("department-page")).not.toBeNull();
  const accepted = navigationGuardFor(window)!.write("/manage/venue-operations/department/gone");
  await choose("discard");
  await accepted;
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector("department-page")).toBeNull();
  expect(shell.shadowRoot!.querySelector("[role=status]")!.textContent).toContain(
    "This department no longer exists.",
  );
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it.each(["move-zone", "disable-zone"])(
  "the real %s menu waits for the zone draft decision before opening its dialog",
  async (action) => {
    const { shell } = await mount("/manage/venue-operations/department/d1/view/zones/zone/z1");
    const snapshot = structuredClone(model);
    snapshot.departments.push({
      id: "d2",
      name: "Deli",
      tradingName: "Shop",

      active: true,
    });
    shell.model = snapshot;
    vi.spyOn(shell.api, "zoneRemovalImpact").mockResolvedValue({
      zones: [],
    });
    await shell.updateComplete;
    const zones = shell.shadowRoot!.querySelector("department-zones")!;
    await zones.updateComplete;
    const fields = zones.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
    const draft = {
      orderStart: "counter" as const,
      paidWhen: null,
      collectionNumber: null,
      receiptPrintMode: "on_request" as const,
    };
    fields.dispatchEvent(
      new CustomEvent("service-settings-change", {
        detail: { value: draft },
        bubbles: true,
        composed: true,
      }),
    );
    await zones.updateComplete;
    const button = zones.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!;
    const dialogs = shell.shadowRoot!.querySelector("department-dialogs")!;
    button.click();
    await choose("keep");
    expect(dialogs.dialog).toBeUndefined();
    expect(fields.value).toEqual(draft);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    button.click();
    await choose("discard");
    await expect.poll(() => dialogs.dialog?.kind).toBe(action);
    expect(dialogs.dialog && "row" in dialogs.dialog && dialogs.dialog.row.id).toBe("z1");
    expect(fields.value).toEqual({
      orderStart: null,
      paidWhen: null,
      collectionNumber: null,
      receiptPrintMode: null,
    });
    expect(app.leave.coordinator.isDirty()).toBe(false);
  },
);

it.each([
  ["rename-department", { departmentId: "d1" }, "Retained name"],
  ["rename-zone", { zoneId: "z1" }, "Garden"],
] as const)(
  "%s retains its edited name when a live read removes the department",
  async (action, detail, name) => {
    const { shell } = await mount(
      action === "rename-zone"
        ? "/manage/venue-operations/department/d1/view/zones/zone/z1"
        : "/manage/venue-operations",
    );
    const request = vi.spyOn(shell.api, "updateDepartment");
    const zoneWrite = vi.spyOn(shell.api, "updateZone");
    shell
      .shadowRoot!.querySelector(
        action === "rename-zone" ? "department-zones" : "departments-list",
      )!
      .dispatchEvent(new CustomEvent(action, { detail, bubbles: true, composed: true }));
    await shell.updateComplete;
    const dialogs = shell.shadowRoot!.querySelector("department-dialogs")!;
    await dialogs.updateComplete;
    const field =
      dialogs.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    field.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: name }, bubbles: true, composed: true }),
    );
    await dialogs.updateComplete;
    const next = structuredClone(model);
    next.departments = [];
    shell.model = next;
    await shell.updateComplete;
    await dialogs.updateComplete;
    expect(field.value).toBe(name);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const cancel = dialogs.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!;
    cancel.click();
    await choose("keep");
    expect(field.value).toBe(name);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    cancel.click();
    await choose("discard");
    await expect.poll(() => dialogs.dialog).toBeUndefined();
    expect(dialogs.shadowRoot!.querySelector("[name=name]")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(zoneWrite).not.toHaveBeenCalled();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  },
);

it("dirty native Escape keeps the rename, then Discard returns focus to its row menu", async () => {
  const { shell } = await mount("/manage/venue-operations");
  const request = vi.fn<(path: string, method?: string) => Promise<unknown>>(async () => ({
    id: "unexpected-write",
  }));
  shell.api = new VenueServiceApi(request as DashboardRequest);
  await shell.updateComplete;
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=rename-department-d1]")!.click();
  const dialogs = shell.shadowRoot!.querySelector("department-dialogs")!;
  await expect.poll(() => dialogs.dialog?.kind).toBe("rename-department");
  const field =
    dialogs.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  await userEvent.fill(page.elementLocator(input), "Retained rename");
  await userEvent.keyboard("{Escape}");
  await choose("keep");
  expect(input.value).toBe("Retained rename");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.click(page.elementLocator(input));
  await userEvent.keyboard("{Escape}");
  await choose("discard");
  await expect.poll(() => dialogs.dialog).toBeUndefined();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const menu = table
    .shadowRoot!.querySelector("[data-test=rename-department-d1]")!
    .closest("wt-row-actions")!;
  await expect
    .poll(() => menu.shadowRoot!.activeElement)
    .toBe(menu.shadowRoot!.querySelector("button"));
  expect(request.mock.calls.filter(([, method]) => method && method !== "GET")).toEqual([]);
});
