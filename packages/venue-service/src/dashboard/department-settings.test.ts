import { afterEach, beforeEach, expect, it } from "vitest";
import { html } from "lit";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import type { DepartmentSettings } from "./department-settings.js";
import "./department-settings.js";
import { selectDepartmentTab } from "../testing/department-edit-fixture.js";
const model: VenueServiceView = {
  departments: [
    {
      id: "d1",
      name: "Restaurant",
      tradingName: "Casa",
      active: true,
    },
    { id: "d2", name: "Deli", tradingName: "Shop", active: true },
    {
      id: "d3",
      name: "Closed",
      tradingName: "Closed",
      active: false,
    },
  ],
  zones: [
    {
      id: "z1",
      name: "Terrace",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "prepay",
      active: true,
    },
    {
      id: "z2",
      name: "Bar",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      active: true,
    },
    {
      id: "z3",
      name: "Same",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      active: true,
    },
    {
      id: "z4",
      name: "Other",
      departmentId: "d2",
      departmentName: "Deli",
      serviceMode: "prepay",
      active: true,
    },
  ],
  floorZones: [],
  readiness: [],
  salePolicies: {
    departments: [
      {
        departmentId: "d1",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        printTradingName: false,
      },
    ],
    zones: [
      {
        zoneId: "z1",
        orderStart: "counter",
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
        effective: {
          orderStart: "counter",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
        },
      },
      {
        zoneId: "z2",
        orderStart: null,
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: "on_request",
        effective: {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "on_request",
          printTradingName: false,
        },
      },
      {
        zoneId: "z3",
        orderStart: "table",
        paidWhen: "prepay",
        collectionNumber: "none",
        receiptPrintMode: "auto",
        effective: {
          orderStart: "table",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
          printTradingName: false,
        },
      },
    ],
  },
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  printMovedSlips: true,
  releaseReminderMinutes: null,
  needsClearingDepartmentIds: [],
  serviceSteps: [],
  courses: [],
};

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  hosts.splice(0).forEach((h) => h.remove());
  setLocale("en");
});
async function mount(view = structuredClone(model), failure?: unknown) {
  const writes: { path: string; method: string; body: unknown }[] = [];
  const reads: string[] = [];
  const api = new VenueServiceApi((async (path, method, body) => {
    if (method === "GET") {
      reads.push(path);
      return path.endsWith("/profiles")
        ? [
            { id: "p1", name: "Restaurant desk" },
            { id: "p2", name: "Handheld desk" },
          ]
        : { departmentId: "d1", receivingProfileId: "p1", destinationDepartmentIds: [] };
    }
    writes.push({ path, method: method!, body });
    if (failure) throw failure;
  }) as DashboardRequest);
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("department-settings") as DepartmentSettings;
  el.api = api;
  el.model = view;
  el.departmentId = "d1";
  host.append(el);
  await el.updateComplete;
  expect(el.shadowRoot, "Settings component renders").not.toBeNull();
  if (view.departments.find((d) => d.id === "d1")?.active)
    await expect.poll(() => el.shadowRoot!.querySelector("[name=name]")).not.toBeNull();
  if (
    view.departments.find((d) => d.id === "d1")?.active &&
    view.departments.filter((d) => d.active).length > 1
  )
    await expect
      .poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]"))
      .not.toBeNull();
  return { el, writes, reads };
}
function field(el: DepartmentSettings, name: string) {
  const control = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name="${name}"]`,
  );
  expect(control, name).not.toBeNull();
  return control!;
}
function save(el: DepartmentSettings) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-editor]",
  )!;
}
async function change(el: DepartmentSettings, name: string, value: string) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function bottom(el: DepartmentSettings) {
  return (
    (await formMessageOf(el.shadowRoot!.querySelector("wt-form-actions")!))?.textContent?.trim() ??
    ""
  );
}

it("opens quiet with Cancel before Save and sends all settings in one request", async () => {
  const { el, writes } = await mount();
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  expect([...actions.querySelectorAll("wt-button")].map((b) => b.textContent!.trim())).toEqual([
    "Cancel",
    "Save",
  ]);
  expect(save(el).disabled).toBe(true);
  expect(save(el).variant).toBe("secondary");
  save(el).dispatchEvent(new MouseEvent("click"));
  await el.updateComplete;
  expect(writes).toEqual([]);
  await change(el, "name", "Restaurant revised");
  await change(el, "tradingName", "Casa revised");
  const service = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  service.dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: {
        value: {
          orderStart: "counter",
          paidWhen: "ticket_then_pay",
          collectionNumber: "numbered",
          receiptPrintMode: "on_request",
        },
      },
      bubbles: true,
      composed: true,
    }),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[name=transferDestination-d2]")!.click();
  await chooseOption(
    el.shadowRoot!.querySelector(
      "[name=receivingProfileId]",
    )! as HTMLElementTagNameMap["wt-combobox"],
    "p2",
  );
  await el.updateComplete;
  expect(save(el).disabled).toBe(false);
  expect(save(el).variant).toBe("primary");
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/departments/d1/settings",
      method: "PUT",
      body: {
        name: "Restaurant revised",
        tradingName: "Casa revised",
        orderStart: "counter",
        paidWhen: "ticket_then_pay",
        collectionNumber: "numbered",
        needsClearing: false,
        transfers: { receivingProfileId: "p2", destinationDepartmentIds: ["d2"] },
      },
    },
  ]);
  await expect.poll(() => save(el).disabled).toBe(true);
});
it("a save that does not touch the steps sends none", async () => {
  const view = structuredClone(model);
  view.courses = [{ id: "c1", name: "Mains" }];
  view.serviceSteps = [
    { id: "s1", departmentId: "d1", name: "Set up", start: "seated", courseId: null, minutes: 0 },
    {
      id: "s2",
      departmentId: "d1",
      name: "Dessert?",
      start: "course_served",
      courseId: "c1",
      minutes: 10,
    },
    {
      id: "s3",
      departmentId: "d2",
      name: "Take order",
      start: "seated",
      courseId: null,
      minutes: 2,
    },
  ];
  const { el, writes } = await mount(view);
  await change(el, "name", "Restaurant revised");
  expect(save(el).disabled).toBe(false);
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.body).toMatchObject({ name: "Restaurant revised" });
  expect(writes[0]!.body).not.toHaveProperty("serviceSteps");
  await expect.poll(() => save(el).disabled).toBe(true);
});
it("lists exactly differing stored overrides as zone links", async () => {
  const { el } = await mount();
  const links = [...el.shadowRoot!.querySelectorAll<HTMLAnchorElement>("[data-zone]")];
  expect(links.map((a) => a.textContent!.trim())).toEqual([
    "Terrace (Counter service)",
    "Bar (Receipt on request)",
  ]);
  expect(links.map((a) => a.getAttribute("href"))).toEqual([
    "/manage/venue-operations/department/d1/view/zones/zone/z1",
    "/manage/venue-operations/department/d1/view/zones/zone/z2",
  ]);
  const heard: unknown[] = [];
  el.addEventListener("zone-change", (e) => heard.push((e as CustomEvent).detail));
  links[1]!.click();
  expect(heard).toEqual([{ zoneId: "z2" }]);
});
it("does not link department settings to a receipt page", async () => {
  const { el } = await mount();
  expect(el.shadowRoot!.querySelector("[data-test=edit-receipt]")).toBeNull();
});
it("hides transfers with one active department and excludes them from Save", async () => {
  const view = structuredClone(model);
  view.departments[1]!.active = false;
  const { el, writes } = await mount(view);
  expect(el.shadowRoot!.querySelector("[data-test=transfers-section]")).toBeNull();
  await change(el, "name", "Revised");
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.body as object).not.toHaveProperty("transfers");
});
it("a transfers read failure stays in that section while the rest of the form saves", async () => {
  const { el } = await mount();
  const writes: unknown[] = [];
  el.remove();
  el.api = new VenueServiceApi((async (_path, method, body) => {
    if (method === "GET") throw { code: "connection.failed" };
    writes.push(body);
  }) as DashboardRequest);
  el.departmentId = "d2";
  hosts[0]!.append(el);
  await el.updateComplete;
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=transfers-load-error]")?.textContent)
    .toContain("Tab transfers could not be loaded");
  expect(await bottom(el)).toBe("");
  expect(el.shadowRoot!.querySelector("[name=receivingProfileId]")).toBeNull();
  await change(el, "name", "Deli revised");
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toHaveProperty("transfers");
});
it("a deleted department offers no editor or Enable action", async () => {
  const view = structuredClone(model);
  view.departments[0]!.active = false;
  const { el, writes } = await mount(view);
  expect(el.shadowRoot!.querySelector("[data-test=save-editor]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=enable-department]")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-input")).toBeNull();
  expect(writes).toEqual([]);
});
it("marks an empty name only after submit and clears it when corrected", async () => {
  const { el, writes } = await mount();
  await change(el, "name", "");
  expect(field(el, "name").error).toBe("");
  save(el).click();
  await el.updateComplete;
  expect(field(el, "name").error).toBe("This field is required.");
  expect(await bottom(el)).toContain("Correct the highlighted fields");
  expect(save(el).disabled).toBe(true);
  expect(writes).toEqual([]);
  await change(el, "name", "Fixed");
  expect(field(el, "name").error).toBe("");
  expect(await bottom(el)).toBe("");
  expect(save(el).disabled).toBe(false);
});
it("a name refusal retains its draft without offering Enable", async () => {
  const { el } = await mount(structuredClone(model), {
    code: "department.name_taken",
    params: { name: "Deli", departmentId: "d2" },
  });
  await change(el, "name", "Deli");
  save(el).click();
  await expect
    .poll(() => field(el, "name").error)
    .toBe("A department with this name already exists.");
  expect(field(el, "name").value).toBe("Deli");
  expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
});
it.each([
  "name",
  "tradingName",
  "orderStart",
  "paidWhen",
  "collectionNumber",
  "receivingProfileId",
  "destinationDepartmentIds",
])("places request-invalid %s beside its field without blocking retry", async (name) => {
  const { el } = await mount(structuredClone(model), {
    code: "management.request_invalid",
    params: { field: name },
  });
  await change(el, "name", "Revised");
  save(el).click();
  await expect.poll(() => bottom(el)).toContain("Correct the highlighted fields");
  const error =
    name === "destinationDepartmentIds"
      ? el.shadowRoot!.querySelector("[data-field-error=destinationDepartmentIds]")?.textContent
      : ["orderStart", "paidWhen", "collectionNumber"].includes(name)
        ? el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.errors[
            name as "orderStart"
          ]
        : field(el, name).getAttribute("error");
  expect(error).toContain("This value was not accepted. Change it and save again.");
  expect(save(el).disabled).toBe(false);
});
it("clears destination refusal on checkbox change and keeps profile choices", async () => {
  const { el } = await mount(structuredClone(model), {
    code: "department_transfer.settings_invalid",
    params: { field: "destinationDepartmentIds" },
  });
  const profile = el.shadowRoot!.querySelector(
    "[name=receivingProfileId]",
  )! as HTMLElementTagNameMap["wt-combobox"];
  expect(profile.value).toBe("p1");
  expect(profile.options.map((o) => o.value)).toEqual(["", "p1", "p2"]);
  expect(el.shadowRoot!.querySelector("[name=transferDestination-d1]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[name=transferDestination-d3]")).toBeNull();
  await change(el, "name", "Revised");
  save(el).click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("fieldset")!.textContent)
    .toContain("Choose active departments other than this one.");
  expect(save(el).disabled).toBe(false);
  el.shadowRoot!.querySelector<HTMLInputElement>("[name=transferDestination-d2]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("fieldset")!.textContent).not.toContain(
    "Choose active departments other than this one.",
  );
  expect(await bottom(el)).toBe("");
});
it("puts a transfer profile refusal beside that field and keeps Save available", async () => {
  const { el } = await mount(structuredClone(model), {
    code: "department_transfer.settings_invalid",
    params: { field: "receivingProfileId" },
  });
  await change(el, "name", "Revised");
  save(el).click();
  await expect
    .poll(() => field(el, "receivingProfileId").getAttribute("error"))
    .toBe("Choose a profile with an active service zone in this department, or no receiving desk.");
  expect(await bottom(el)).not.toBe("");
  expect(save(el).disabled).toBe(false);
});
it("keeps newer edits when a save finishes and ignores completions from a disconnected editor", async () => {
  const { el } = await mount();
  let finish!: () => void;
  el.api = new VenueServiceApi((() => new Promise<void>((r) => (finish = r))) as DashboardRequest);
  await change(el, "name", "Submitted");
  save(el).click();
  await el.updateComplete;
  expect(field(el, "name").disabled).toBe(false);
  field(el, "name").dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Ignored while busy" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(field(el, "name").value).toBe("Ignored while busy");
  el.remove();
  hosts[0]!.append(el);
  await el.updateComplete;
  await change(el, "name", "Retained");
  finish();
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  expect(field(el, "name").value).toBe("Retained");
  expect(save(el).disabled).toBe(false);
});

it("a late transfer load keeps a name edit dirty and does not resurrect a departed department's settings", async () => {
  const { el } = await mount();
  el.remove();
  const reads: { path: string; finish: (value: unknown) => void }[] = [];
  el.api = new VenueServiceApi(
    ((path: string) =>
      new Promise<unknown>((resolve) => reads.push({ path, finish: resolve }))) as DashboardRequest,
  );
  el.departmentId = "d2";
  hosts[0]!.append(el);
  await el.updateComplete;
  await change(el, "name", "Deli draft");
  el.departmentId = "d1";
  await el.updateComplete;
  const old = reads.filter((r) => r.path.includes("/d2/"));
  old.forEach((r) =>
    r.finish(
      r.path.endsWith("/profiles")
        ? [{ id: "old", name: "Departed desk" }]
        : { departmentId: "d2", receivingProfileId: "old", destinationDepartmentIds: ["d1"] },
    ),
  );
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[name=receivingProfileId]")).toBeNull();
  await change(el, "name", "Restaurant draft");
  reads
    .filter((r) => r.path.includes("/d1/"))
    .forEach((r) =>
      r.finish(
        r.path.endsWith("/profiles")
          ? [{ id: "new", name: "New desk" }]
          : { departmentId: "d1", receivingProfileId: "new", destinationDepartmentIds: [] },
      ),
    );
  await expect.poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]")).not.toBeNull();
  expect(field(el, "name").value).toBe("Restaurant draft");
  expect(save(el).disabled).toBe(false);
  expect(
    (
      el.shadowRoot!.querySelector(
        "[name=receivingProfileId]",
      ) as HTMLElementTagNameMap["wt-combobox"]
    ).value,
  ).toBe("new");
});
it("undoing a service or destination change returns Save to quiet without depending on selection order", async () => {
  const view = structuredClone(model);
  view.departments.push({
    id: "d4",
    name: "Cafe",
    tradingName: "Coffee",

    active: true,
  });
  const { el } = await mount(view);
  const service = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  const update = async (paidWhen: "prepay" | "ticket_then_pay") => {
    service.dispatchEvent(
      new CustomEvent("service-settings-change", {
        detail: {
          value: {
            orderStart: "table",
            paidWhen,
            collectionNumber: "none",
            receiptPrintMode: "auto",
          },
        },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
  };
  await update("ticket_then_pay");
  expect(save(el).disabled).toBe(false);
  await update("prepay");
  expect(save(el).disabled).toBe(true);
  const toggle = async (id: string) => {
    el.shadowRoot!.querySelector<HTMLInputElement>(`[name=transferDestination-${id}]`)!.click();
    await el.updateComplete;
  };
  await toggle("d2");
  await toggle("d4");
  save(el).click();
  await expect.poll(() => save(el).disabled).toBe(true);
  await toggle("d2");
  await toggle("d2");
  expect(save(el).disabled).toBe(true);
  expect(save(el).variant).toBe("secondary");
});
it("a service-setting change updates the differing-zone readout while null overrides follow", async () => {
  const view = structuredClone(model);
  view.salePolicies.zones[1]!.paidWhen = null;
  view.salePolicies.zones[1]!.receiptPrintMode = null;
  const { el } = await mount(view);
  const service = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  service.dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: {
        value: {
          orderStart: "table",
          paidWhen: "ticket_then_pay",
          collectionNumber: "none",
          receiptPrintMode: "on_request",
        },
      },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(
    [...el.shadowRoot!.querySelectorAll<HTMLAnchorElement>("[data-zone]")].map((a) =>
      a.textContent!.trim(),
    ),
  ).toEqual(["Terrace (Counter service)", "Same (Paid before preparation)"]);
});
it("a request failure naming no field stays at the bottom and allows retry", async () => {
  const { el } = await mount(structuredClone(model), { code: "connection.failed" });
  await change(el, "name", "Revised");
  save(el).click();
  await expect.poll(() => bottom(el)).toBe("The change could not be saved.");
  expect(field(el, "name").error).toBe("");
  expect(save(el).disabled).toBe(false);
});
it("deleted department transfer controls cannot be edited or enabled", async () => {
  const view = structuredClone(model);
  view.departments[0]!.active = false;
  const { el, writes } = await mount(view);
  expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=enable-department]")).toBeNull();
  expect(writes).toEqual([]);
});

it("hiding transfers during a pending save releases the action and never sends hidden transfers on the next save", async () => {
  const { el } = await mount();
  let finish!: () => void;
  const sent: unknown[] = [];
  el.api = new VenueServiceApi(((_path, method, body) => {
    if (method === "GET") return Promise.resolve([]);
    sent.push(body);
    return new Promise<void>((r) => (finish = r));
  }) as DashboardRequest);
  await change(el, "name", "Submitted");
  save(el).click();
  await el.updateComplete;
  const view = structuredClone(model);
  view.departments[1]!.active = false;
  el.model = view;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=transfers-section]")).toBeNull();
  finish();
  await expect.poll(() => field(el, "name").disabled).toBe(false);
  await change(el, "name", "Next");
  save(el).click();
  await el.updateComplete;
  expect(sent).toHaveLength(2);
  expect(sent[1]).not.toHaveProperty("transfers");
  finish();
  await expect.poll(() => save(el).disabled).toBe(true);
});
it("a same-department snapshot updates pristine fields but leaves a dirty draft and its baseline intact", async () => {
  const { el } = await mount();
  const updated = structuredClone(model);
  updated.departments[0]!.name = "Live name";
  updated.salePolicies.departments[0]!.receiptPrintMode = "on_request";
  el.model = updated;
  await el.updateComplete;
  expect(field(el, "name").value).toBe("Live name");
  expect(
    el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.value.receiptPrintMode,
  ).toBe("on_request");
  expect(save(el).disabled).toBe(true);
  await change(el, "name", "Draft");
  const newer = structuredClone(updated);
  newer.departments[0]!.name = "Newer live name";
  el.model = newer;
  await el.updateComplete;
  expect(field(el, "name").value).toBe("Draft");
  expect(save(el).disabled).toBe(false);
});
it("a pristine form remains quiet when transfers become hidden and ignores a late read after hiding", async () => {
  const { el } = await mount();
  const view = structuredClone(model);
  view.departments[1]!.active = false;
  el.model = view;
  await el.updateComplete;
  expect(save(el).disabled).toBe(true);
  const reads: { path: string; finish: (value: unknown) => void }[] = [];
  el.api = new VenueServiceApi(
    ((path) =>
      new Promise<unknown>((resolve) => reads.push({ path, finish: resolve }))) as DashboardRequest,
  );
  el.model = structuredClone(model);
  await el.updateComplete;
  expect(save(el).disabled).toBe(true);
  await change(el, "name", "Draft");
  el.model = view;
  await el.updateComplete;
  reads.forEach((r) =>
    r.finish(
      r.path.endsWith("/profiles")
        ? []
        : { departmentId: "d1", receivingProfileId: null, destinationDepartmentIds: [] },
    ),
  );
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=transfers-section]")).toBeNull();
  expect(field(el, "name").value).toBe("Draft");
  expect(save(el).disabled).toBe(false);
});
it("Cancel without an application restores the form and emits the department", async () => {
  const { el } = await mount();
  const heard: unknown[] = [];
  el.addEventListener("cancelled", (e) => heard.push((e as CustomEvent).detail));
  await change(el, "name", "Draft");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await el.updateComplete;
  expect(field(el, "name").value).toBe("Restaurant");
  expect(save(el).disabled).toBe(true);
  expect(heard).toEqual([{ departmentId: "d1" }]);
});
it("Enter in a changed text field saves once and sends trimmed values", async () => {
  const { el, writes } = await mount();
  await change(el, "name", " Restaurant revised ");
  const control = field(el, "name");
  await control.updateComplete;
  control.shadowRoot!.querySelector("input")!.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
  await expect.poll(() => writes.length).toBe(1);
  expect((writes[0]!.body as { name: string }).name).toBe("Restaurant revised");
});
it("None clears the receiving desk while an unavailable stored profile stays visible until changed", async () => {
  const { el } = await mount();
  el.remove();
  el.departmentId = "d2";
  el.api = new VenueServiceApi((async (path, method) =>
    method === "GET"
      ? path.endsWith("/profiles")
        ? [{ id: "p2", name: "Handheld desk" }]
        : { departmentId: "d2", receivingProfileId: "gone", destinationDepartmentIds: [] }
      : undefined) as DashboardRequest);
  hosts[0]!.append(el);
  await el.updateComplete;
  await expect.poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]")).not.toBeNull();
  const box = el.shadowRoot!.querySelector("wt-combobox")!;
  expect(box.value).toBe("gone");
  expect(box.options).toEqual([
    { value: "", label: "None" },
    { value: "p2", label: "Handheld desk" },
    { value: "gone", label: "Unavailable profile — choose another or no receiving desk" },
  ]);
  await chooseOption(box, "");
  await el.updateComplete;
  expect(box.value).toBe("");
  expect(save(el).disabled).toBe(false);
});
it("an active-name clash without transfers marks the name and offers no Enable", async () => {
  const view = structuredClone(model);
  view.departments[1]!.active = false;
  const { el } = await mount(view, { code: "department.name_taken" });
  await change(el, "name", "Deli");
  save(el).click();
  await expect
    .poll(() => field(el, "name").error)
    .toBe("A department with this name already exists.");
  expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
  expect(save(el).disabled).toBe(false);
});
it("a null request failure stays at the bottom without marking a field", async () => {
  const { el } = await mount();
  el.api = new VenueServiceApi((async () => {
    throw null;
  }) as DashboardRequest);
  await change(el, "name", "Draft");
  save(el).click();
  await expect.poll(() => bottom(el)).toBe("The change could not be saved.");
  expect(field(el, "name").error).toBe("");
  expect(save(el).disabled).toBe(false);
});
it("differing-zone summaries name paid timing and collection choices independently", async () => {
  const view = structuredClone(model);
  view.salePolicies.zones[0]!.orderStart = "table";
  view.salePolicies.zones[0]!.paidWhen = "ticket_then_pay";
  view.salePolicies.zones[0]!.collectionNumber = "numbered";
  const { el } = await mount(view);
  expect(el.shadowRoot!.querySelector("[data-zone=z1]")!.textContent).toBe(
    "Terrace (Paid at collection, Print)",
  );
  const service = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  service.dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: {
        value: {
          orderStart: "counter",
          paidWhen: "ticket_then_pay",
          collectionNumber: "numbered",
          receiptPrintMode: "on_request",
        },
      },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-zone=z3]")!.textContent).toBe(
    "Same (Table service, Paid before preparation, Don't print)",
  );
});
it("a pristine refresh without transfers applies the latest trading name", async () => {
  const view = structuredClone(model);
  view.departments[1]!.active = false;
  const { el } = await mount(view);
  view.departments[0]!.tradingName = "Latest trading name";
  el.model = structuredClone(view);
  await el.updateComplete;
  expect(field(el, "tradingName").value).toBe("Latest trading name");
  expect(save(el).disabled).toBe(true);
});
it.each(["table_tab", "ticket_then_pay"] as const)(
  "a department without a policy row ignores retired %s and displays current defaults",
  async (mode) => {
    const view = structuredClone(model);
    view.salePolicies.departments = [];
    Object.assign(view.departments[0]!, { defaultServiceMode: mode });
    const { el } = await mount(view);
    expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.value).toMatchObject({
      orderStart: "counter",
      paidWhen: "prepay",
      collectionNumber: "none",
      receiptPrintMode: "auto",
    });
  },
);
it("waits for a known department before showing an editor", async () => {
  const host = document.createElement("div");
  hosts.push(host);
  document.body.append(host);
  const el = document.createElement("department-settings");
  host.append(el);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[name=name]")).toBeNull();
  el.model = structuredClone(model);
  el.departmentId = "missing";
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[name=name]")).toBeNull();
});
it("a different destination set with the same count is still an edit", async () => {
  const view = structuredClone(model);
  view.departments.push({
    id: "d4",
    name: "Cafe",
    tradingName: "Coffee",

    active: true,
  });
  const { el } = await mount(view);
  const toggle = async (id: string) => {
    el.shadowRoot!.querySelector<HTMLInputElement>(`[name=transferDestination-${id}]`)!.click();
    await el.updateComplete;
  };
  await toggle("d2");
  save(el).click();
  await expect.poll(() => save(el).disabled).toBe(true);
  await toggle("d2");
  await toggle("d4");
  expect(save(el).disabled).toBe(false);
  expect(save(el).variant).toBe("primary");
});

it("a destination deactivated while transfers remain shown can be corrected without losing a name edit", async () => {
  const view = structuredClone(model);
  view.departments.push({
    id: "d4",
    name: "Cafe",
    tradingName: "Coffee",

    active: true,
  });
  const { el, writes } = await mount(view);
  await change(el, "name", "Name draft");
  el.shadowRoot!.querySelector<HTMLInputElement>("[name=transferDestination-d2]")!.click();
  await el.updateComplete;
  const live = structuredClone(view);
  live.departments[1]!.active = false;
  el.model = live;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=transfers-section]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[name=transferDestination-d2]")).toBeNull();
  expect(field(el, "name").value).toBe("Name draft");
  expect(save(el).disabled).toBe(false);
  el.shadowRoot!.querySelector<HTMLInputElement>("[name=transferDestination-d4]")!.click();
  await el.updateComplete;
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.body).toMatchObject({
    name: "Name draft",
    transfers: { receivingProfileId: "p1", destinationDepartmentIds: ["d4"] },
  });
  await expect.poll(() => save(el).disabled).toBe(true);
});
it("owned zone links emit through the dashboard capture boundary while plain links remain shell-owned", async () => {
  const { el } = await mount();
  const shell: string[] = [];
  const zones: unknown[] = [];
  el.addEventListener("zone-change", (e) => zones.push((e as CustomEvent).detail));
  const capture = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const anchor = event
      .composedPath()
      .find(
        (node): node is HTMLAnchorElement =>
          node instanceof HTMLAnchorElement && node.hasAttribute("href"),
      );
    if (!anchor) return;
    if (anchor.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      return;
    }
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      anchor.hasAttribute("data-own-click") ||
      anchor.hasAttribute("download") ||
      anchor.getAttribute("href")?.startsWith("#") ||
      (anchor.target !== "" && anchor.target !== "_self")
    )
      return;
    const url = new URL(anchor.href);
    if (
      url.origin !== location.origin ||
      (url.pathname !== "/manage" && !url.pathname.startsWith("/manage/"))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    shell.push(url.pathname + url.search);
  };
  hosts[0]!.addEventListener("click", capture, { capture: true });
  const zone = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-zone=z1]")!;
  zone.click();
  expect(zones).toEqual([{ zoneId: "z1" }]);
  expect(shell).toEqual([]);
  expect(el.shadowRoot!.querySelector("[data-test=edit-receipt]")).toBeNull();
  expect(shell).toEqual([]);
  const observed: boolean[] = [];
  const cancelBrowserDefault = (event: MouseEvent) => {
    observed.push(event.defaultPrevented);
    event.preventDefault();
  };
  hosts[0]!.addEventListener("click", cancelBrowserDefault);
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    zone.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        composed: true,
        cancelable: true,
        [modifier]: true,
      }),
    );
  }
  expect(observed).toEqual([false, false, false, false]);
  expect(zones).toEqual([{ zoneId: "z1" }]);
  expect(shell).toHaveLength(0);
});

it.each([
  ["orderStart", "counter", "paidWhen", "ticket_then_pay"],
  ["paidWhen", "ticket_then_pay", "orderStart", "counter"],
  ["collectionNumber", "numbered", "paidWhen", "ticket_then_pay"],
] as const)(
  "a refused %s survives a different service edit until its own value changes",
  async (refused, corrected, other, value) => {
    const { el } = await mount(structuredClone(model), {
      code: "management.request_invalid",
      params: { field: refused },
    });
    await change(el, "name", "Revised");
    save(el).click();
    const service = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
    const message = "This value was not accepted. Change it and save again.";
    await expect.poll(() => service.errors[refused]).toBe(message);
    await service.updateComplete;
    await chooseOption(
      service.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(`[name=${other}]`)!,
      value,
    );
    await el.updateComplete;
    expect(service.errors[refused]).toBe(message);
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(save(el).disabled).toBe(false);
    await service.updateComplete;
    if (refused === "collectionNumber") {
      const toggle =
        service.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
          "[name=collectionNumber]",
        )!;
      await toggle.updateComplete;
      toggle.shadowRoot!.querySelector<HTMLInputElement>("input")!.click();
      await toggle.updateComplete;
      expect(toggle.shadowRoot!.querySelector<HTMLInputElement>("input")!.checked).toBe(
        corrected === "numbered",
      );
    } else {
      await chooseOption(
        service.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
          `[name=${refused}]`,
        )!,
        corrected,
      );
    }
    await el.updateComplete;
    expect(service.errors[refused]).toBeUndefined();
    expect(await bottom(el)).toBe("");
    expect(save(el).disabled).toBe(false);
  },
);

it.each(["old-first", "fresh-first"] as const)(
  "a same-department reconnect ignores the departed transfer read: %s",
  async (order) => {
    const { el } = await mount();
    el.remove();
    el.departmentId = "d2";
    const reads: { path: string; finish: (value: unknown) => void }[] = [];
    el.api = new VenueServiceApi(
      ((path) =>
        new Promise<unknown>((finish) => {
          reads.push({ path, finish });
        })) as DashboardRequest,
    );
    hosts[0]!.append(el);
    await el.updateComplete;
    await expect.poll(() => reads.length).toBe(2);
    await change(el, "name", "Deli draft");
    el.remove();
    hosts[0]!.append(el);
    await el.updateComplete;
    await expect.poll(() => reads.length).toBe(4);
    const complete = async (offset: number, profile: string, destinations: string[]) => {
      for (const read of reads.slice(offset, offset + 2))
        read.finish(
          read.path.endsWith("/profiles")
            ? [{ id: profile, name: `${profile} desk` }]
            : {
                departmentId: "d2",
                receivingProfileId: profile,
                destinationDepartmentIds: destinations,
              },
        );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
    };
    if (order === "old-first") {
      await complete(0, "old", ["d1"]);
      expect(el.shadowRoot!.querySelector("[name=receivingProfileId]")).toBeNull();
      await complete(2, "fresh", []);
    } else {
      await complete(2, "fresh", []);
      await complete(0, "old", ["d1"]);
    }
    await expect
      .poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]"))
      .not.toBeNull();
    const profile = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[name=receivingProfileId]",
    )!;
    expect(profile.value).toBe("fresh");
    expect(profile.options.map((option) => option.value)).toEqual(["", "fresh"]);
    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>("[name=transferDestination-d1]")!.checked,
    ).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-test=transfers-load-error]")).toBeNull();
    expect(field(el, "name").value).toBe("Deli draft");
    expect(save(el).disabled).toBe(false);
    await change(el, "name", "Deli");
    expect(save(el).disabled).toBe(true);
  },
);

it("a native trading-name refusal survives a name edit and clears on its own input", async () => {
  const { el, writes } = await mount(structuredClone(model), {
    code: "management.request_invalid",
    params: { field: "tradingName" },
  });
  const trading = field(el, "tradingName");
  await trading.updateComplete;
  const native = trading.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(native), "Casa revised");
  await el.updateComplete;
  save(el).click();
  await expect
    .poll(() => trading.error)
    .toBe("This value was not accepted. Change it and save again.");
  await trading.updateComplete;
  expect(native.getAttribute("aria-invalid")).toBe("true");
  await expect.poll(() => trading.shadowRoot!.activeElement).toBe(native);
  expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(native.value).toBe("Casa revised");
  expect(save(el).disabled).toBe(false);
  await change(el, "name", "Restaurant revised");
  expect(trading.error).toBe("This value was not accepted. Change it and save again.");
  expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
  await userEvent.fill(page.elementLocator(native), "Casa corrected");
  await el.updateComplete;
  await trading.updateComplete;
  expect(trading.error).toBe("");
  expect(native.getAttribute("aria-invalid")).toBe("false");
  expect(await bottom(el)).toBe("");
  expect(save(el).disabled).toBe(false);
  expect(writes).toHaveLength(1);
  expect(writes[0]!.body).toMatchObject({ name: "Restaurant", tradingName: "Casa revised" });
});

it("a blank native trading name is refused without writing and Cancel restores it", async () => {
  const { el, writes } = await mount();
  const box = field(el, "tradingName");
  await box.updateComplete;
  const native = box.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(native), "   ");
  await el.updateComplete;
  save(el).click();
  await el.updateComplete;
  expect(box.error).toBe("This field is required.");
  expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(writes).toEqual([]);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await el.updateComplete;
  expect(box.value).toBe("Casa");
  expect(box.error).toBe("");
  expect(save(el).disabled).toBe(true);
});

it.each([
  ["paidWhen", "prepay", "ticket_then_pay"],
  ["collectionNumber", "none", "numbered"],
] as const)(
  "a refused department %s reverts to its baseline without another write",
  async (name, baseline, changed) => {
    const { el, writes } = await mount(undefined, new Error("offline"));
    const fields = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
    await fields.updateComplete;
    const select = async (value: string) => {
      if (name === "collectionNumber") {
        const box = fields.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
          `wt-switch[name=${name}]`,
        )!;
        await box.updateComplete;
        box.shadowRoot!.querySelector<HTMLInputElement>("input")!.click();
      } else
        await chooseOption(
          fields.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
            `wt-combobox[name=${name}]`,
          )!,
          value,
        );
      await el.updateComplete;
      await fields.updateComplete;
    };
    await select(changed);
    save(el).click();
    await expect.poll(() => bottom(el)).toBe("The change could not be saved.");
    expect(fields.value[name]).toBe(changed);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.body).toMatchObject({ [name]: changed });
    await select(baseline);
    expect(fields.value[name]).toBe(baseline);
    save(el).click();
    await el.updateComplete;
    expect(writes).toHaveLength(1);
    expect(save(el).disabled).toBe(true);
    expect(save(el).variant).toBe("secondary");
    expect(await bottom(el)).toBe("");
  },
);

it("choosing the saved paid option sends no write or reload and contains raw changes", async () => {
  const { el, writes, reads } = await mount();
  const fields = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  await fields.updateComplete;
  const box = fields.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "wt-combobox[name=paidWhen]",
  )!;
  const before = [...reads];
  const raw: Event[] = [];
  const listen = (event: Event) => raw.push(event);
  document.addEventListener("wt-change", listen);
  try {
    await chooseOption(box, "prepay");
    await el.updateComplete;
    expect(writes).toEqual([]);
    expect(reads).toEqual(before);
    expect(save(el).disabled).toBe(true);
    await chooseOption(box, "ticket_then_pay");
    await el.updateComplete;
    expect(fields.value.paidWhen).toBe("ticket_then_pay");
    expect(raw).toEqual([]);
    expect(writes).toEqual([]);
  } finally {
    document.removeEventListener("wt-change", listen);
  }
});

it("department fields put trading name immediately after name and leave receipt switches to their editor", async () => {
  const { el } = await mount();
  const names = [...el.shadowRoot!.querySelectorAll("wt-input")].map((field) =>
    field.getAttribute("name"),
  );
  expect(names.slice(0, 2)).toEqual(["name", "tradingName"]);
  const trading = field(el, "tradingName");
  const service = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  expect(trading.compareDocumentPosition(service) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await service.updateComplete;
  expect(service.shadowRoot!.querySelector('[name="receiptPrintMode"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[name="printTradingName"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="edit-receipt"]')).toBeNull();
});
function strip(el: DepartmentSettings) {
  return el.shadowRoot!.querySelector("wt-tabs")!;
}
function shownPanel(el: DepartmentSettings) {
  const panels = [...el.shadowRoot!.querySelectorAll<HTMLElement>("wt-tabs > [slot]")];
  const shown = panels.filter((panel) => panel.checkVisibility());
  expect(shown.length, "one panel shows").toBe(1);
  return shown[0]!;
}
function tabEvents(el: DepartmentSettings) {
  const events: unknown[] = [];
  el.addEventListener("department-tab-change", (e) => events.push((e as CustomEvent).detail));
  return events;
}
it("draws Details, Service and Transfers tabs with Details first and the name fields on it", async () => {
  const { el } = await mount();
  await strip(el).updateComplete;
  expect(strip(el).items.map((item) => item.key)).toEqual(["details", "service", "transfers"]);
  expect(strip(el).items.map((item) => item.label)).toEqual(["Details", "Service", "Transfers"]);
  expect(strip(el).label).toBe("Department");
  expect(el.tab).toBe("details");
  expect(el.offeredTabs).toEqual(["details", "service", "transfers"]);
  const panel = shownPanel(el);
  expect(panel.querySelector("[name=name]")).not.toBeNull();
  expect(panel.querySelector("[name=tradingName]")).not.toBeNull();
  expect(panel.querySelector("dashboard-service-settings-fields")).toBeNull();
  expect(panel.querySelector("[name=receivingProfileId]")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-tabs wt-form-actions")).toBeNull();
});
it("the Service tab holds Orders and payment", async () => {
  const { el } = await mount();
  const events = tabEvents(el);
  await selectDepartmentTab(el, "service");
  expect(el.tab).toBe("service");
  expect(events).toEqual([{ tab: "service", replace: false }]);
  const panel = shownPanel(el);
  const section = panel.querySelector("section")!;
  expect(section.querySelector("h3")!.textContent!.trim()).toBe("Orders and payment");
  expect(section.querySelector("dashboard-service-settings-fields")).not.toBeNull();
  expect(section.querySelector("[data-test=zones-that-differ]")).not.toBeNull();
  expect(panel.querySelector("[name=name]")).toBeNull();
});
it("names the tabs and the Orders and payment heading in Spanish", async () => {
  setLocale("es");
  const { el } = await mount();
  await strip(el).updateComplete;
  expect(strip(el).label).toBe("Departamento");
  expect(strip(el).items.map((item) => item.label)).toEqual(["Datos", "Servicio", "Traslados"]);
  expect(el.shadowRoot!.querySelector("[slot=service] h3")!.textContent!.trim()).toBe(
    "Pedidos y cobro",
  );
});
it("offers no Transfers tab with one active department", async () => {
  const view = structuredClone(model);
  view.departments[1]!.active = false;
  const { el } = await mount(view);
  await strip(el).updateComplete;
  expect(strip(el).items.map((item) => item.key)).toEqual(["details", "service"]);
  expect(el.offeredTabs).toEqual(["details", "service"]);
});
it("a draft typed on two tabs is sent by one Save", async () => {
  const { el, writes } = await mount();
  await change(el, "name", "Restaurant revised");
  await selectDepartmentTab(el, "service");
  el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: {
        value: {
          orderStart: "counter",
          paidWhen: "prepay",
          collectionNumber: "none",
          receiptPrintMode: "auto",
        },
      },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.path).toBe("/management-api/venue-service/departments/d1/settings");
  expect(writes[0]!.body).toMatchObject({ name: "Restaurant revised", orderStart: "counter" });
  await el.updateComplete;
  expect(writes).toHaveLength(1);
});
it("Save with a blank name from the Service tab shows Details, marks it and focuses the name", async () => {
  const { el, writes } = await mount();
  await change(el, "name", "");
  await selectDepartmentTab(el, "service");
  const events = tabEvents(el);
  save(el).click();
  await expect.poll(() => el.tab).toBe("details");
  expect(events).toEqual([{ tab: "details", replace: true }]);
  await strip(el).updateComplete;
  expect(strip(el).items.map((item) => item.marked)).toEqual([
    "needs fixing",
    undefined,
    undefined,
  ]);
  expect(shownPanel(el).querySelector("[name=name]")).not.toBeNull();
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(field(el, "name"));
  expect(field(el, "name").shadowRoot!.activeElement).toBe(
    field(el, "name").shadowRoot!.querySelector("input"),
  );
  expect(writes).toEqual([]);
});
it("a refusal naming a Transfers field shows the Transfers tab and marks it", async () => {
  const { el } = await mount(structuredClone(model), {
    code: "department_transfer.settings_invalid",
    params: { field: "receivingProfileId" },
  });
  await change(el, "name", "Revised");
  const events = tabEvents(el);
  save(el).click();
  await expect.poll(() => el.tab).toBe("transfers");
  expect(events).toEqual([{ tab: "transfers", replace: true }]);
  await strip(el).updateComplete;
  expect(strip(el).items.map((item) => item.marked)).toEqual([
    undefined,
    undefined,
    "needs fixing",
  ]);
  expect(shownPanel(el).querySelector("[name=receivingProfileId]")).not.toBeNull();
  await expect
    .poll(() => el.shadowRoot!.activeElement)
    .toBe(el.shadowRoot!.querySelector("[name=receivingProfileId]"));
});
it("a refusal naming a Service field shows the Service tab, marks it and focuses the field", async () => {
  const { el } = await mount(structuredClone(model), {
    code: "management.request_invalid",
    params: { field: "orderStart" },
  });
  await change(el, "name", "Revised");
  const events = tabEvents(el);
  save(el).click();
  await expect.poll(() => el.tab).toBe("service");
  expect(events).toEqual([{ tab: "service", replace: true }]);
  await strip(el).updateComplete;
  expect(strip(el).items.map((item) => item.marked)).toEqual([
    undefined,
    "needs fixing",
    undefined,
  ]);
  const service = shownPanel(el).querySelector("dashboard-service-settings-fields")!;
  expect(service).not.toBeNull();
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(service);
  expect(service.shadowRoot!.activeElement).toBe(
    service.shadowRoot!.querySelector("[name=orderStart]"),
  );
});
it("a refusal landing while the name is blank marks Details and Transfers and shows Details", async () => {
  const { el } = await mount();
  let refuse!: () => void;
  const refused = new Promise<void>((resolve) => (refuse = resolve));
  el.api = new VenueServiceApi((async (_path, method) => {
    if (method === "GET")
      return { departmentId: "d1", receivingProfileId: "p1", destinationDepartmentIds: [] };
    await refused;
    throw { code: "department_transfer.settings_invalid", params: { field: "receivingProfileId" } };
  }) as DashboardRequest);
  await change(el, "name", "Revised");
  save(el).click();
  await change(el, "name", "");
  await selectDepartmentTab(el, "service");
  const events = tabEvents(el);
  refuse();
  await expect.poll(() => el.tab).toBe("details");
  expect(events).toEqual([{ tab: "details", replace: true }]);
  await strip(el).updateComplete;
  expect(strip(el).items.map((item) => item.marked)).toEqual([
    "needs fixing",
    undefined,
    "needs fixing",
  ]);
  expect(shownPanel(el).querySelector("[name=name]")).not.toBeNull();
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(field(el, "name"));
});
it("losing the second department while Transfers shows returns to Details and keeps the draft", async () => {
  const { el } = await mount();
  await change(el, "name", "Draft");
  await selectDepartmentTab(el, "transfers");
  expect(shownPanel(el).querySelector("[name=receivingProfileId]")).not.toBeNull();
  const view = structuredClone(model);
  view.departments[1]!.active = false;
  el.model = view;
  await el.updateComplete;
  await strip(el).updateComplete;
  expect(el.tab).toBe("details");
  expect(strip(el).items.map((item) => item.key)).toEqual(["details", "service"]);
  expect(shownPanel(el).querySelector("[name=name]")).not.toBeNull();
  expect(field(el, "name").value).toBe("Draft");
  expect(el.hasUnsavedChanges).toBe(true);
});
function needsClearing(el: DepartmentSettings) {
  const control = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
    "wt-switch[name=needsClearing]",
  );
  expect(control, "Needs clearing switch").not.toBeNull();
  return control!;
}
async function toggleNeedsClearing(el: DepartmentSettings, checked: boolean) {
  needsClearing(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
it("shows Needs clearing under Table states on the Service tab, off for a department the model does not list", async () => {
  const { el } = await mount();
  await selectDepartmentTab(el, "service");
  const panel = shownPanel(el);
  const section = needsClearing(el).closest("section")!;
  expect(panel.contains(section)).toBe(true);
  expect(section.getAttribute("aria-label")).toBe("Table states");
  expect(section.querySelector("h3")!.textContent!.trim()).toBe("Table states");
  const sections = [...panel.querySelectorAll("section")];
  expect(sections.indexOf(section)).toBe(1);
  expect(needsClearing(el).label).toBe("Needs clearing");
  expect(needsClearing(el).checked).toBe(false);
  expect(needsClearing(el).getAttribute("aria-invalid")).toBeNull();
  const hint = "A table stays “Needs clearing” after the party leaves, until marked cleared.";
  expect(needsClearing(el).description).toBe(hint);
  expect(section.querySelector(".hint")!.textContent!.trim()).toBe(hint);
  expect(section.querySelector("[data-field-error=needsClearing]")).toBeNull();
});
it("shows it on for a department the model lists", async () => {
  const view = structuredClone(model);
  view.needsClearingDepartmentIds = ["d1"];
  const { el } = await mount(view);
  expect(needsClearing(el).checked).toBe(true);
});
it("switching it on enables Save and saves it with the department", async () => {
  const { el, writes } = await mount();
  await selectDepartmentTab(el, "service");
  expect(save(el).disabled).toBe(true);
  expect(save(el).variant).toBe("secondary");
  await toggleNeedsClearing(el, true);
  expect(save(el).disabled).toBe(false);
  expect(save(el).variant).toBe("primary");
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.path).toBe("/management-api/venue-service/departments/d1/settings");
  expect(writes[0]!.body).toMatchObject({ needsClearing: true });
  await expect.poll(() => save(el).disabled).toBe(true);
});
it("a refusal naming the switch, sent while Details shows, brings back Service and marks it", async () => {
  const { el } = await mount(structuredClone(model), {
    code: "management.request_invalid",
    params: { field: "needsClearing" },
  });
  await change(el, "name", "Revised");
  expect(el.tab).toBe("details");
  const events = tabEvents(el);
  save(el).click();
  await expect.poll(() => el.tab).toBe("service");
  expect(events).toEqual([{ tab: "service", replace: true }]);
  await strip(el).updateComplete;
  expect(strip(el).items.map((item) => item.marked)).toEqual([
    undefined,
    "needs fixing",
    undefined,
  ]);
  const control = needsClearing(el);
  expect(shownPanel(el).contains(control)).toBe(true);
  expect(control.getAttribute("aria-invalid")).toBe("true");
  expect(control.description).toContain("This value was not accepted. Change it and save again.");
  expect(
    shownPanel(el).querySelector("[data-field-error=needsClearing]")!.textContent!.trim(),
  ).toBe("This value was not accepted. Change it and save again.");
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(control);
  expect(control.shadowRoot!.activeElement).toBe(
    control.shadowRoot!.querySelector("input[role=switch]"),
  );
  expect(save(el).disabled).toBe(false);
});
it("follows a change another dashboard makes while the form is clean, and keeps a draft while it is not", async () => {
  const { el } = await mount();
  const listed = structuredClone(model);
  listed.needsClearingDepartmentIds = ["d1"];
  el.model = listed;
  await el.updateComplete;
  expect(needsClearing(el).checked).toBe(true);
  expect(save(el).disabled).toBe(true);
  await toggleNeedsClearing(el, false);
  expect(save(el).disabled).toBe(false);
  const relisted = structuredClone(listed);
  relisted.departments[0]!.tradingName = "Casa nueva";
  el.model = relisted;
  await el.updateComplete;
  expect(needsClearing(el).checked).toBe(false);
  expect(el.hasUnsavedChanges).toBe(true);
  expect(save(el).disabled).toBe(false);
});
it("reads in Spanish", async () => {
  setLocale("es");
  const { el } = await mount();
  const section = needsClearing(el).closest("section")!;
  expect(section.querySelector("h3")!.textContent!.trim()).toBe("Estados de la mesa");
  expect(needsClearing(el).label).toBe("Por recoger");
  expect(section.querySelector(".hint")!.textContent!.trim()).toBe(
    "Una mesa queda «Por recoger» cuando el grupo se va, hasta que se marca como recogida.",
  );
});
const stepsView = () => {
  const view = structuredClone(model);
  view.courses = [
    { id: "c1", name: "Mains" },
    { id: "c2", name: "Desserts" },
  ];
  view.serviceSteps = [
    { id: "s1", departmentId: "d1", name: "Set up", start: "seated", courseId: null, minutes: 0 },
    {
      id: "s2",
      departmentId: "d1",
      name: "Take order",
      start: "after_previous",
      courseId: null,
      minutes: 2,
    },
    {
      id: "s3",
      departmentId: "d1",
      name: "Dessert?",
      start: "course_served",
      courseId: "c1",
      minutes: 10,
    },
    { id: "s9", departmentId: "d2", name: "Greet", start: "seated", courseId: null, minutes: 2 },
  ];
  return view;
};
const SENT_STEPS = [
  { id: "s1", name: "Set up", start: "seated", courseId: null, minutes: 0 },
  { id: "s2", name: "Take order", start: "after_previous", courseId: null, minutes: 2 },
  { id: "s3", name: "Dessert?", start: "course_served", courseId: "c1", minutes: 10 },
];
type StepControl = HTMLElement & {
  value: string;
  error: string;
  updateComplete: Promise<unknown>;
};
function stepList(el: DepartmentSettings) {
  const list = el.shadowRoot!.querySelector("department-service-steps");
  expect(list, "service step list").not.toBeNull();
  return list!;
}
function stepRows(el: DepartmentSettings) {
  return [...stepList(el).shadowRoot!.querySelectorAll("tbody tr")];
}
function stepControl(el: DepartmentSettings, index: number, name: "Name" | "Start" | "Minutes") {
  const control = stepRows(el)[index]?.querySelector<StepControl>(`[name=serviceStep${name}]`);
  expect(control, `step ${index} ${name}`).toBeTruthy();
  return control!;
}
async function settled(el: DepartmentSettings) {
  await el.updateComplete;
  const list = stepList(el);
  await list.updateComplete;
  await Promise.all(
    [...list.shadowRoot!.querySelectorAll<StepControl>("wt-input, wt-combobox, wt-button")].map(
      (control) => control.updateComplete,
    ),
  );
}
async function editStep(
  el: DepartmentSettings,
  index: number,
  name: "Name" | "Minutes",
  value: string,
) {
  stepControl(el, index, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settled(el);
}
async function chooseStart(el: DepartmentSettings, index: number, value: string) {
  await chooseOption(stepControl(el, index, "Start"), value);
  await settled(el);
}
async function addStep(el: DepartmentSettings) {
  stepList(el).shadowRoot!.querySelector<HTMLElement>("[data-test=add-service-step]")!.click();
  await settled(el);
}
function listError(el: DepartmentSettings) {
  return (
    stepList(el).shadowRoot!.querySelector("[data-test=list-error]")?.textContent?.trim() ?? ""
  );
}
function stepErrors(el: DepartmentSettings) {
  return stepRows(el).map((_, index) =>
    (["Name", "Start", "Minutes"] as const).map((name) => stepControl(el, index, name).error),
  );
}
const REFUSED = "This value was not accepted. Change it and save again.";
const COURSE_GONE = "That course was deleted. Choose another start.";
it("shows Service steps under Table states, below Needs clearing, with this department's steps", async () => {
  const { el } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  const list = stepList(el);
  const section = needsClearing(el).closest("section")!;
  expect(shownPanel(el).contains(list)).toBe(true);
  expect(section.contains(list)).toBe(true);
  expect(
    needsClearing(el).compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(list.shadowRoot!.querySelector("h4")!.textContent!.trim()).toBe("Service steps");
  expect(list.disabled).toBe(false);
  expect(list.courses).toEqual([
    { id: "c1", name: "Mains" },
    { id: "c2", name: "Desserts" },
  ]);
  await settled(el);
  expect(stepRows(el).map((_, index) => stepControl(el, index, "Name").value)).toEqual([
    "Set up",
    "Take order",
    "Dessert?",
  ]);
  expect(stepControl(el, 2, "Start").value).toBe("course_served:c1");
  expect(stepControl(el, 1, "Minutes").value).toBe("2");
  expect(save(el).disabled).toBe(true);
});
it("adding a step enables Save; saving sends the whole list, the new step without an id", async () => {
  const { el, writes } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  await settled(el);
  await addStep(el);
  expect(save(el).disabled).toBe(false);
  expect(save(el).variant).toBe("primary");
  await editStep(el, 3, "Name", "Coffee");
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect((writes[0]!.body as { serviceSteps: unknown }).serviceSteps).toEqual([
    ...SENT_STEPS,
    { name: "Coffee", start: "after_previous", courseId: null, minutes: 0 },
  ]);
  await expect.poll(() => save(el).disabled).toBe(true);
});
it("follows a change to the steps another dashboard makes while the form is clean, and keeps the draft while it is not", async () => {
  const { el } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  const renamed = stepsView();
  renamed.serviceSteps[1]!.name = "Take the order";
  el.model = renamed;
  await settled(el);
  expect(stepControl(el, 1, "Name").value).toBe("Take the order");
  expect(save(el).disabled).toBe(true);
  await editStep(el, 0, "Name", "Lay the table");
  const later = structuredClone(renamed);
  later.serviceSteps[2]!.minutes = 15;
  el.model = later;
  await settled(el);
  expect(stepControl(el, 0, "Name").value).toBe("Lay the table");
  expect(stepControl(el, 2, "Minutes").value).toBe("10");
  expect(el.hasUnsavedChanges).toBe(true);
  expect(save(el).disabled).toBe(false);
});
it("after a save, the model's copy with the new step's id replaces the clean draft, and the next step change sends that id", async () => {
  const { el, writes } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  await settled(el);
  await addStep(el);
  await editStep(el, 3, "Name", "Coffee");
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect.poll(() => save(el).disabled).toBe(true);
  const refreshed = stepsView();
  refreshed.serviceSteps.splice(3, 0, {
    id: "s4",
    departmentId: "d1",
    name: "Coffee",
    start: "after_previous",
    courseId: null,
    minutes: 0,
  });
  el.model = refreshed;
  await settled(el);
  expect(stepList(el).steps.map((step) => step.id)).toEqual(["s1", "s2", "s3", "s4"]);
  expect(save(el).disabled).toBe(true);
  await editStep(el, 3, "Minutes", "5");
  save(el).click();
  await expect.poll(() => writes.length).toBe(2);
  expect((writes[1]!.body as { serviceSteps: unknown }).serviceSteps).toEqual([
    ...SENT_STEPS,
    { id: "s4", name: "Coffee", start: "after_previous", courseId: null, minutes: 5 },
  ]);
});
const withCoffee = () => {
  const view = stepsView();
  view.serviceSteps.splice(3, 0, {
    id: "s4",
    departmentId: "d1",
    name: "Coffee",
    start: "after_previous",
    courseId: null,
    minutes: 0,
  });
  return view;
};
it("a step edited while the saved list's refresh is pending keeps the new step's id when the refresh lands", async () => {
  await import("./department-edit-dialog.js");
  const { el: original, writes } = await mount(stepsView());
  const dialog = document.createElement("department-edit-dialog");
  dialog.api = original.api!;
  dialog.model = stepsView();
  dialog.departmentId = "d1";
  dialog.receiptEditor = html`${Object.assign(document.createElement("div"), {
    hasUnsavedChanges: true,
  })}`;
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  host.append(dialog);
  await dialog.updateComplete;
  const el = dialog.shadowRoot!.querySelector("department-settings")!;
  await settled(el);
  const written: unknown[] = [];
  dialog.addEventListener("written", (event) => written.push(event));
  await selectDepartmentTab(el, "service");
  await addStep(el);
  await editStep(el, 3, "Name", "Coffee");
  save(el).click();
  await expect.poll(() => written.length).toBe(1);
  expect(el.receiptHasUnsavedChanges).toBe(true);
  expect(dialog.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  dialog.refreshing = true;
  await dialog.updateComplete;
  await settled(el);
  await editStep(el, 3, "Minutes", "5");
  dialog.model = withCoffee();
  dialog.refreshing = false;
  await dialog.updateComplete;
  await settled(el);
  expect(stepControl(el, 3, "Minutes").value).toBe("5");
  save(el).click();
  await expect.poll(() => writes.length).toBe(2);
  expect((writes[1]!.body as { serviceSteps: unknown[] }).serviceSteps).toEqual([
    ...SENT_STEPS,
    { id: "s4", name: "Coffee", start: "after_previous", courseId: null, minutes: 5 },
  ]);
});
it("a rename made before the saved list's refresh lands keeps the rename and takes the new step's id", async () => {
  const { el, writes } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  await settled(el);
  await addStep(el);
  await editStep(el, 3, "Name", "Coffee");
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect.poll(() => save(el).disabled).toBe(true);
  await change(el, "name", "Restaurant revised");
  el.model = withCoffee();
  await settled(el);
  expect(field(el, "name").value).toBe("Restaurant revised");
  expect(stepList(el).steps.map((step) => step.id)).toEqual(["s1", "s2", "s3", "s4"]);
  save(el).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]!.body).toMatchObject({ name: "Restaurant revised" });
  expect(writes[1]!.body).not.toHaveProperty("serviceSteps");
  await expect.poll(() => save(el).disabled).toBe(true);
  await editStep(el, 3, "Minutes", "5");
  save(el).click();
  await expect.poll(() => writes.length).toBe(3);
  expect((writes[2]!.body as { serviceSteps: unknown }).serviceSteps).toEqual([
    ...SENT_STEPS,
    { id: "s4", name: "Coffee", start: "after_previous", courseId: null, minutes: 5 },
  ]);
});
it("a step added before the saved list's refresh lands is still sent as new, beside the saved step's id", async () => {
  const { el, writes } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  await settled(el);
  await addStep(el);
  await editStep(el, 3, "Name", "Coffee");
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect.poll(() => save(el).disabled).toBe(true);
  await addStep(el);
  await editStep(el, 4, "Name", "Tea");
  el.model = withCoffee();
  await settled(el);
  expect(stepList(el).steps.map((step) => [step.id, step.name])).toEqual([
    ["s1", "Set up"],
    ["s2", "Take order"],
    ["s3", "Dessert?"],
    ["s4", "Coffee"],
    [null, "Tea"],
  ]);
  save(el).click();
  await expect.poll(() => writes.length).toBe(2);
  expect((writes[1]!.body as { serviceSteps: unknown }).serviceSteps).toEqual([
    ...SENT_STEPS,
    { id: "s4", name: "Coffee", start: "after_previous", courseId: null, minutes: 0 },
    { name: "Tea", start: "after_previous", courseId: null, minutes: 0 },
  ]);
});
it("a step list another manager changed while a rename is in progress shows their list, and the rename saves", async () => {
  const { el, writes } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  await settled(el);
  await change(el, "name", "Restaurant revised");
  const gone = stepsView();
  gone.courses = [{ id: "c2", name: "Desserts" }];
  gone.serviceSteps = gone.serviceSteps.filter((step) => step.id !== "s3");
  el.model = gone;
  await settled(el);
  expect(field(el, "name").value).toBe("Restaurant revised");
  expect(stepList(el).steps.map((step) => step.id)).toEqual(["s1", "s2"]);
  expect(save(el).disabled).toBe(false);
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.body).toMatchObject({ name: "Restaurant revised" });
  expect(writes[0]!.body).not.toHaveProperty("serviceSteps");
  await expect.poll(() => save(el).disabled).toBe(true);
  expect(el.hasUnsavedChanges).toBe(false);
});
for (const refresh of ["before any refreshed model arrives", "after the refresh failed"]) {
  it(`a rename made after saving a new step, ${refresh}, keeps the new step and sends it with the next step save`, async () => {
    const { el, writes } = await mount(stepsView());
    await selectDepartmentTab(el, "service");
    await settled(el);
    await addStep(el);
    await editStep(el, 3, "Name", "Coffee");
    save(el).click();
    await expect.poll(() => writes.length).toBe(1);
    await expect.poll(() => save(el).disabled).toBe(true);
    if (refresh === "after the refresh failed") {
      el.refreshing = true;
      await settled(el);
      el.refreshing = false;
      await settled(el);
    }
    await change(el, "name", "Restaurant revised");
    await settled(el);
    expect(stepList(el).steps.map((step) => step.name)).toEqual([
      "Set up",
      "Take order",
      "Dessert?",
      "Coffee",
    ]);
    await addStep(el);
    await editStep(el, 4, "Name", "Tea");
    save(el).click();
    await expect.poll(() => writes.length).toBe(2);
    expect((writes[1]!.body as { serviceSteps: unknown }).serviceSteps).toEqual([
      ...SENT_STEPS,
      { name: "Coffee", start: "after_previous", courseId: null, minutes: 0 },
      { name: "Tea", start: "after_previous", courseId: null, minutes: 0 },
    ]);
  });
}
it("while a rename is unsaved, another manager's change back of a just-saved step name is followed once the saved list has arrived", async () => {
  const { el } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  await settled(el);
  await editStep(el, 2, "Name", "Pudding?");
  save(el).click();
  await expect.poll(() => save(el).disabled).toBe(true);
  await change(el, "name", "Restaurant revised");
  const saved = stepsView();
  saved.serviceSteps[2]!.name = "Pudding?";
  el.model = saved;
  await settled(el);
  expect(stepControl(el, 2, "Name").value).toBe("Pudding?");
  el.model = stepsView();
  await settled(el);
  expect(stepControl(el, 2, "Name").value).toBe("Dessert?");
  expect(field(el, "name").value).toBe("Restaurant revised");
});
it("a rename saves when another manager put a just-saved step's start back and deleted the course it had moved to", async () => {
  const { el, writes } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  await settled(el);
  await chooseStart(el, 2, "course_served:c2");
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect.poll(() => save(el).disabled).toBe(true);
  await change(el, "name", "Restaurant revised");
  const back = stepsView();
  back.courses = [{ id: "c1", name: "Mains" }];
  el.model = back;
  await settled(el);
  expect(save(el).disabled).toBe(false);
  save(el).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]!.body).toMatchObject({ name: "Restaurant revised" });
  expect(writes[1]!.body).not.toHaveProperty("serviceSteps");
  expect(stepErrors(el)).toEqual([
    ["", "", ""],
    ["", "", ""],
    ["", "", ""],
  ]);
});
const laid = (tradingName?: string) => {
  const view = stepsView();
  view.serviceSteps[0]!.name = "Lay table";
  if (tradingName) view.departments[0]!.tradingName = tradingName;
  return view;
};
const COFFEE = { name: "Coffee", start: "after_previous", courseId: null, minutes: 0 };
const TEA = { name: "Tea", start: "after_previous", courseId: null, minutes: 0 };
const stepNames = (el: DepartmentSettings) => stepList(el).steps.map((step) => step.name);
const sentSteps = (body: unknown) => (body as { serviceSteps?: unknown }).serviceSteps;
function holdSaves(el: DepartmentSettings) {
  const sent: unknown[] = [];
  const finishes: (() => void)[] = [];
  el.api = new VenueServiceApi(((_path, method, body) => {
    if (method === "GET") return Promise.resolve([]);
    sent.push(body);
    return new Promise<void>((resolve) => finishes.push(resolve));
  }) as DashboardRequest);
  return { sent, finish: () => finishes.shift()!() };
}
const cancelButton = (el: DepartmentSettings) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=cancel-editor]")!;
for (const other of ["renamed the first step", "renamed the first step and the trading name"]) {
  it(`a copy in which another manager ${other}, which arrived while a new step was unsaved, is not taken back once the step is saved`, async () => {
    const { el, writes } = await mount(stepsView());
    await selectDepartmentTab(el, "service");
    await settled(el);
    await addStep(el);
    await editStep(el, 3, "Name", "Coffee");
    el.model = laid(other.endsWith("trading name") ? "Casa revised" : undefined);
    await settled(el);
    save(el).click();
    await expect.poll(() => writes.length).toBe(1);
    await expect.poll(() => save(el).disabled).toBe(true);
    await settled(el);
    expect(stepNames(el)).toEqual(["Set up", "Take order", "Dessert?", "Coffee"]);
    await addStep(el);
    await editStep(el, 4, "Name", "Tea");
    save(el).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(sentSteps(writes[1]!.body)).toEqual([...SENT_STEPS, COFFEE, TEA]);
  });
}
it("after a save overrides another manager's older copy, a step added before the refresh lands is sent beside the saved step's id", async () => {
  const { el, writes } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  await settled(el);
  await addStep(el);
  await editStep(el, 3, "Name", "Coffee");
  el.model = laid();
  await settled(el);
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect.poll(() => save(el).disabled).toBe(true);
  await addStep(el);
  await editStep(el, stepRows(el).length - 1, "Name", "Tea");
  el.model = withCoffee();
  await settled(el);
  save(el).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(sentSteps(writes[1]!.body)).toEqual([...SENT_STEPS, { id: "s4", ...COFFEE }, TEA]);
});
for (const during of ["nothing else is edited", "the department is renamed"]) {
  it(`a copy in which another manager renamed a step, arriving while a new step's save is sent and ${during}, is not taken after the save answers`, async () => {
    const { el } = await mount(stepsView());
    await selectDepartmentTab(el, "service");
    await settled(el);
    const { sent, finish } = holdSaves(el);
    await addStep(el);
    await editStep(el, 3, "Name", "Coffee");
    save(el).click();
    await expect.poll(() => sent.length).toBe(1);
    el.model = laid();
    await settled(el);
    if (during === "the department is renamed") await change(el, "name", "Restaurant revised");
    finish();
    await expect.poll(() => cancelButton(el).disabled).toBe(false);
    await settled(el);
    expect(stepNames(el)).toEqual(["Set up", "Take order", "Dessert?", "Coffee"]);
    await addStep(el);
    await editStep(el, 4, "Name", "Tea");
    save(el).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sentSteps(sent[1])).toEqual([...SENT_STEPS, COFFEE, TEA]);
    if (during === "the department is renamed")
      expect(sent[1]).toMatchObject({ name: "Restaurant revised" });
    finish();
  });
}
it("a step list another manager changed while a rename's save is sent is shown after the save answers", async () => {
  const { el } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  await settled(el);
  const { sent, finish } = holdSaves(el);
  await change(el, "name", "Restaurant revised");
  save(el).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).not.toHaveProperty("serviceSteps");
  const gone = stepsView();
  gone.serviceSteps = gone.serviceSteps.filter((step) => step.id !== "s3");
  el.model = gone;
  await settled(el);
  finish();
  await expect.poll(() => cancelButton(el).disabled).toBe(false);
  await settled(el);
  expect(stepNames(el)).toEqual(["Set up", "Take order"]);
  await addStep(el);
  await editStep(el, 2, "Name", "Tea");
  save(el).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sentSteps(sent[1])).toEqual([...SENT_STEPS.slice(0, 2), TEA]);
  finish();
});
it("changing a step and changing it back sends no steps", async () => {
  const { el, writes } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  await settled(el);
  await editStep(el, 1, "Name", "Take orders");
  expect(save(el).disabled).toBe(false);
  await editStep(el, 1, "Name", "Take order");
  expect(save(el).disabled).toBe(true);
  await change(el, "name", "Restaurant revised");
  save(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.body).not.toHaveProperty("serviceSteps");
});
it.each([
  {
    rule: "a blank name",
    at: [1, 0] as const,
    message: "This field is required.",
    breakIt: (el: DepartmentSettings) => editStep(el, 1, "Name", "  "),
    fix: (el: DepartmentSettings) => editStep(el, 1, "Name", "Take orders"),
  },
  {
    rule: "a fraction of a minute",
    at: [1, 2] as const,
    message: "Whole minutes, 0 to 120.",
    breakIt: (el: DepartmentSettings) => editStep(el, 1, "Minutes", "2.5"),
    fix: (el: DepartmentSettings) => editStep(el, 1, "Minutes", "3"),
  },
  {
    rule: "blank minutes",
    at: [1, 2] as const,
    message: "Whole minutes, 0 to 120.",
    breakIt: (el: DepartmentSettings) => editStep(el, 1, "Minutes", ""),
    fix: (el: DepartmentSettings) => editStep(el, 1, "Minutes", "0"),
  },
  {
    rule: "more than 120 minutes",
    at: [1, 2] as const,
    message: "Whole minutes, 0 to 120.",
    breakIt: (el: DepartmentSettings) => editStep(el, 1, "Minutes", "121"),
    fix: (el: DepartmentSettings) => editStep(el, 1, "Minutes", "120"),
  },
  {
    rule: "0 for a repeating step",
    at: [2, 2] as const,
    message: "At least 1 minute.",
    breakIt: async (el: DepartmentSettings) => {
      await chooseStart(el, 2, "since_last_order");
      await editStep(el, 2, "Minutes", "0");
    },
    fix: (el: DepartmentSettings) => editStep(el, 2, "Minutes", "1"),
  },
  {
    rule: "a first step after the step before",
    at: [0, 1] as const,
    message: "The first step has no step before it.",
    breakIt: (el: DepartmentSettings) => chooseStart(el, 0, "after_previous"),
    fix: (el: DepartmentSettings) => chooseStart(el, 0, "all_served"),
  },
])(
  "a blank name, a fraction of a minute, 0 for a repeating step and a first step after the step before are each marked after Save, and Save stays disabled until fixed: $rule",
  async ({ at, message, breakIt, fix }) => {
    const { el, writes } = await mount(stepsView());
    await selectDepartmentTab(el, "service");
    await settled(el);
    await breakIt(el);
    const blank = [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
    ];
    expect(stepErrors(el)).toEqual(blank);
    expect(save(el).disabled).toBe(false);
    save(el).click();
    await settled(el);
    expect(writes).toEqual([]);
    const marked = structuredClone(blank);
    marked[at[0]]![at[1]] = message;
    expect(stepErrors(el)).toEqual(marked);
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(save(el).disabled).toBe(true);
    await strip(el).updateComplete;
    expect(strip(el).items.map((item) => item.marked)).toEqual([
      undefined,
      "needs fixing",
      undefined,
    ]);
    await fix(el);
    expect(stepErrors(el)).toEqual(blank);
    expect(await bottom(el)).toBe("");
    expect(save(el).disabled).toBe(false);
  },
);
it("a step whose course another dashboard deleted is marked That course was deleted. Choose another start.", async () => {
  const { el, writes } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  await settled(el);
  await editStep(el, 2, "Name", "Pudding?");
  const gone = stepsView();
  gone.courses = [{ id: "c2", name: "Desserts" }];
  gone.serviceSteps = gone.serviceSteps.filter((step) => step.id !== "s3");
  el.model = gone;
  await settled(el);
  expect(stepControl(el, 2, "Name").value).toBe("Pudding?");
  expect(stepControl(el, 2, "Start").error).toBe("");
  save(el).click();
  await settled(el);
  expect(writes).toEqual([]);
  expect(stepControl(el, 2, "Start").error).toBe(COURSE_GONE);
  expect(save(el).disabled).toBe(true);
  await chooseStart(el, 2, "all_served");
  expect(stepControl(el, 2, "Start").error).toBe("");
  expect(save(el).disabled).toBe(false);
});
it("a refusal naming a step's field, sent while Details shows, brings back Service, marks that field and focuses it", async () => {
  for (const [refusedField, index, control] of [
    ["serviceSteps.1.name", 1, "Name"],
    ["serviceSteps.0.courseId", 0, "Start"],
    ["serviceSteps.2.minutes", 2, "Minutes"],
  ] as const) {
    const { el } = await mount(stepsView(), {
      code: "management.request_invalid",
      params: { field: refusedField },
    });
    await selectDepartmentTab(el, "service");
    await settled(el);
    await editStep(el, 1, "Name", "Take orders");
    await selectDepartmentTab(el, "details");
    const events = tabEvents(el);
    save(el).click();
    await expect.poll(() => el.tab).toBe("service");
    expect(events).toEqual([{ tab: "service", replace: true }]);
    await settled(el);
    expect(stepControl(el, index, control).error).toBe(REFUSED);
    expect(stepErrors(el).flat().filter(Boolean)).toEqual([REFUSED]);
    expect(listError(el)).toBe("");
    await strip(el).updateComplete;
    expect(strip(el).items.map((item) => item.marked)).toEqual([
      undefined,
      "needs fixing",
      undefined,
    ]);
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(stepList(el));
    expect(stepList(el).shadowRoot!.activeElement).toBe(stepControl(el, index, control));
    expect(save(el).disabled).toBe(false);
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
  }
  for (const refusedField of ["serviceSteps", "serviceSteps.1", "serviceSteps.1.id"]) {
    const { el } = await mount(stepsView(), {
      code: "management.request_invalid",
      params: { field: refusedField },
    });
    await selectDepartmentTab(el, "service");
    await settled(el);
    await editStep(el, 1, "Name", "Take orders");
    await selectDepartmentTab(el, "details");
    save(el).click();
    await expect.poll(() => el.tab).toBe("service");
    await settled(el);
    expect(listError(el)).toBe(REFUSED);
    expect(stepErrors(el).flat().filter(Boolean)).toEqual([]);
    expect(save(el).disabled).toBe(false);
    expect(await bottom(el)).toBe("");
    await editStep(el, 1, "Name", "Take the orders");
    expect(listError(el)).toBe("");
  }
});
it("a course deleted meanwhile is named under every step that starts from it", async () => {
  const { el } = await mount(stepsView(), {
    code: "course.not_found",
    params: { courseId: "c1" },
  });
  await selectDepartmentTab(el, "service");
  await settled(el);
  await chooseStart(el, 1, "course_served:c1");
  save(el).click();
  await expect.poll(() => stepControl(el, 1, "Start").error).toBe(COURSE_GONE);
  expect(stepErrors(el)).toEqual([
    ["", "", ""],
    ["", COURSE_GONE, ""],
    ["", COURSE_GONE, ""],
  ]);
  expect(listError(el)).toBe("");
  expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(save(el).disabled).toBe(false);
  await chooseStart(el, 1, "all_served");
  expect(stepErrors(el)).toEqual([
    ["", "", ""],
    ["", "", ""],
    ["", COURSE_GONE, ""],
  ]);
});
it("a course refusal landing after a step's start was changed to Everything served leaves that step unmarked", async () => {
  const { el } = await mount(stepsView());
  let refuse!: () => void;
  const refused = new Promise<void>((resolve) => (refuse = resolve));
  el.api = new VenueServiceApi((async (_path, method) => {
    if (method === "GET")
      return { departmentId: "d1", receivingProfileId: "p1", destinationDepartmentIds: [] };
    await refused;
    throw { code: "course.not_found", params: { courseId: "c1" } };
  }) as DashboardRequest);
  await selectDepartmentTab(el, "service");
  await settled(el);
  await chooseStart(el, 1, "course_served:c1");
  save(el).click();
  await chooseStart(el, 2, "all_served");
  refuse();
  await expect.poll(() => stepControl(el, 1, "Start").error).toBe(COURSE_GONE);
  expect(stepErrors(el)).toEqual([
    ["", "", ""],
    ["", COURSE_GONE, ""],
    ["", "", ""],
  ]);
});
it("a step another manager deleted says so, and Cancel emits cancelled", async () => {
  const { el } = await mount(stepsView(), {
    code: "service_step.not_found",
    params: { stepId: "s2" },
  });
  await selectDepartmentTab(el, "service");
  await settled(el);
  await editStep(el, 1, "Name", "Take orders");
  save(el).click();
  await expect
    .poll(() => listError(el))
    .toBe("A step was changed elsewhere. Cancel and open it again to see the latest.");
  expect(stepErrors(el).flat().filter(Boolean)).toEqual([]);
  expect(save(el).disabled).toBe(false);
  expect(await bottom(el)).toBe("");
  const heard: unknown[] = [];
  el.addEventListener("cancelled", (e) => heard.push((e as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await el.updateComplete;
  expect(heard).toEqual([{ departmentId: "d1" }]);
});
it("a list refusal beside a highlighted field keeps Correct the highlighted fields at the bottom", async () => {
  const { el } = await mount(stepsView(), {
    code: "service_step.not_found",
    params: { stepId: "s2" },
  });
  await selectDepartmentTab(el, "service");
  await settled(el);
  await editStep(el, 1, "Name", "Take orders");
  save(el).click();
  await expect
    .poll(() => listError(el))
    .toBe("A step was changed elsewhere. Cancel and open it again to see the latest.");
  expect(await bottom(el)).toBe("");
  await change(el, "name", "");
  expect(field(el, "name").error).toBe("This field is required.");
  expect(listError(el)).toBe(
    "A step was changed elsewhere. Cancel and open it again to see the latest.",
  );
  expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
});
it("reads in Spanish: Pasos de servicio under Estados de la mesa", async () => {
  setLocale("es");
  const { el } = await mount(stepsView());
  await selectDepartmentTab(el, "service");
  const section = needsClearing(el).closest("section")!;
  expect(section.querySelector("h3")!.textContent!.trim()).toBe("Estados de la mesa");
  const list = stepList(el);
  expect(section.contains(list)).toBe(true);
  expect(list.shadowRoot!.querySelector("h4")!.textContent!.trim()).toBe("Pasos de servicio");
});
