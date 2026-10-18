import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController, UrlStateController, navigationGuardFor } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import { departmentHoursModel } from "../testing/department-hours-fixture.js";
import "./venue-departments-shell.js";
import { selectDepartmentTab } from "../testing/department-edit-fixture.js";

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
  printMovedSlips: true,
  releaseReminderMinutes: null,
  clearingWorkflow: false,
};
class App extends LitElement {
  model = model;
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
        : path.endsWith("/opening-hours")
          ? departmentHoursModel()
          : { departmentId: "d1", receivingProfileId: null, destinationDepartmentIds: [] },
    ) as DashboardRequest,
  );
  override render() {
    return html`<venue-departments-shell
        .model=${this.model}
        .api=${this.api}
        @click=${(event: MouseEvent) => {
          const anchor = event
            .composedPath()
            .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
          if (
            !anchor ||
            event.defaultPrevented ||
            event.button ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          void navigationGuardFor(window)!.write(anchor.getAttribute("href")!);
        }}
      ></venue-departments-shell
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
  const page = shell.shadowRoot!.querySelector("department-edit-dialog");
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
it("the real differing-zone link keeps the edited department until Discard accepts the zone URL", async () => {
  const { shell, page: editor, settings } = await mount();
  const next = structuredClone(model);
  next.salePolicies.zones = [
    {
      zoneId: "z1",
      orderStart: "table",
      paidWhen: null,
      collectionNumber: null,
      receiptPrintMode: null,
      effective: {
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        printTradingName: false,
      },
    },
  ];
  app.model = next;
  shell.model = next;
  await shell.updateComplete;
  await editor.updateComplete;
  await settings.updateComplete;
  await edit(settings);
  await selectDepartmentTab(settings, "service");
  const link = settings.shadowRoot!.querySelector<HTMLAnchorElement>(
    "[data-test=zones-that-differ] a",
  )!;
  await userEvent.click(page.elementLocator(link));
  await choose("keep");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1");
  expect(
    (settings.shadowRoot!.querySelector("[name=name]")! as HTMLElementTagNameMap["wt-input"]).value,
  ).toBe("Draft");
  expect(shell.shadowRoot!.querySelector("department-edit-dialog")).toBe(editor);
  await userEvent.click(page.elementLocator(link));
  await choose("discard");
  await expect.poll(() => shell.shadowRoot!.querySelector("zone-edit-dialog")?.zoneId).toBe("z1");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1/view/zones/zone/z1");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("browser Back restores the edited page while Keep is chosen, then Discard returns to the list", async () => {
  const { shell, settings } = await mount("/manage/venue-operations");
  await navigationGuardFor(window)!.write("/manage/venue-operations/department/d1");
  await shell.updateComplete;
  const page = shell.shadowRoot!.querySelector("department-edit-dialog")!;
  await page.updateComplete;
  const current = page.shadowRoot!.querySelector("department-settings")!;
  await current.updateComplete;
  await edit(current);
  const length = history.length;
  history.back();
  await choose("keep");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1");
  expect(shell.shadowRoot!.querySelector("department-edit-dialog")).toBe(page);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(history.length).toBe(length);
  history.back();
  await choose("discard");
  await expect.poll(() => location.pathname).toBe("/manage/venue-operations");
  expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
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
  expect(shell.shadowRoot!.querySelector("department-edit-dialog")).not.toBeNull();
  const accepted = navigationGuardFor(window)!.write("/manage/venue-operations/department/gone");
  await choose("discard");
  await accepted;
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector("department-edit-dialog")).toBeNull();
  expect(shell.shadowRoot!.querySelector("[role=status]")!.textContent).toContain(
    "This department no longer exists.",
  );
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("leaving a dirty zone editor for another page waits for the draft decision before navigation", async () => {
  const { shell } = await mount("/manage/venue-operations/department/d1/view/zones/zone/z1");
  const zone = shell.shadowRoot!.querySelector("zone-edit-dialog")!;
  await zone.updateComplete;
  const fields = zone.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
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
  await zone.updateComplete;
  const away = "/manage/opening-hours/view/season/season/autumn/department/d1/zone/z1";
  const kept = navigationGuardFor(window)!.write(away);
  await choose("keep");
  await kept;
  expect(location.pathname).toBe("/manage/venue-operations/department/d1/view/zones/zone/z1");
  expect(fields.value).toMatchObject(draft);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  void navigationGuardFor(window)!.write(away);
  await choose("discard");
  await expect.poll(() => location.pathname).toBe(away);
  expect(fields.value).toMatchObject({
    orderStart: null,
    paidWhen: null,
    collectionNumber: null,
    receiptPrintMode: null,
  });
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it.each(["department", "zone"] as const)(
  "a dirty %s editor closes without writing when its live identity disappears",
  async (kind) => {
    const { shell } = await mount(
      kind === "zone"
        ? "/manage/venue-operations/department/d1/view/zones/zone/z1"
        : "/manage/venue-operations/department/d1",
    );
    const request = vi.spyOn(shell.api, "saveDepartmentSettings");
    const zoneWrite = vi.spyOn(shell.api, "saveZoneSettings");
    const editor = shell.shadowRoot!.querySelector(`${kind}-edit-dialog`)!;
    await editor.updateComplete;
    const form =
      kind === "department"
        ? (editor as HTMLElementTagNameMap["department-edit-dialog"]).shadowRoot!.querySelector(
            "department-settings",
          )!
        : editor;
    await form.updateComplete;
    const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    await field.updateComplete;
    await userEvent.fill(
      page.elementLocator(field.shadowRoot!.querySelector("input")!),
      "Retained name",
    );
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const next = structuredClone(model);
    next.departments = [];
    shell.model = next;
    await expect.poll(() => shell.shadowRoot!.querySelector(`${kind}-edit-dialog`)).toBeNull();
    expect(field.isConnected).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(zoneWrite).not.toHaveBeenCalled();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  },
);
it("dirty native Escape keeps the department edit, then Discard returns focus to its row menu", async () => {
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
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=open-department-d1]")!.click();
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).not.toBeNull();
  const editor = shell.shadowRoot!.querySelector("department-edit-dialog")!;
  await editor.updateComplete;
  const form = editor.shadowRoot!.querySelector("department-settings")!;
  await form.updateComplete;
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
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
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const menu = table
    .shadowRoot!.querySelector("[data-test=open-department-d1]")!
    .closest("wt-row-actions")!;
  await expect
    .poll(() => menu.shadowRoot!.activeElement)
    .toBe(menu.shadowRoot!.querySelector("button"));
  expect(request.mock.calls.filter(([, method]) => method && method !== "GET")).toEqual([]);
});

it("keeping a requested zone switch retains the department editor's originating menu", async () => {
  const { shell } = await mount("/manage/venue-operations");
  const next = structuredClone(model);
  next.salePolicies.zones = [
    {
      zoneId: "z1",
      orderStart: "table",
      paidWhen: null,
      collectionNumber: null,
      receiptPrintMode: null,
      effective: {
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        printTradingName: false,
      },
    },
  ];
  app.model = next;
  shell.model = next;
  await shell.updateComplete;
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const action = table.shadowRoot!.querySelector<HTMLElement>("[data-test=open-department-d1]")!;
  const menu = action.closest("wt-row-actions")!;
  await menu.updateComplete;
  const trigger = menu.shadowRoot!.querySelector("button")!;
  action.click();
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).not.toBeNull();
  const editor = shell.shadowRoot!.querySelector("department-edit-dialog")!;
  await editor.updateComplete;
  const form = editor.shadowRoot!.querySelector("department-settings")!;
  await form.updateComplete;
  await edit(form);
  await selectDepartmentTab(form, "service");
  const link = form.shadowRoot!.querySelector<HTMLAnchorElement>(
    "[data-test=zones-that-differ] a",
  )!;
  await userEvent.click(page.elementLocator(link));
  await choose("keep");
  expect(location.pathname).toBe("/manage/venue-operations/department/d1");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choose("discard");
  await expect.poll(() => shell.shadowRoot!.querySelector("department-edit-dialog")).toBeNull();
  await expect.poll(() => menu.shadowRoot!.activeElement).toBe(trigger);
});
