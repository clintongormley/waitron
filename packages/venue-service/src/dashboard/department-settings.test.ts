import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { VenueServiceApi, type VenueServiceView } from "./client.js";
import type { DepartmentSettings } from "./department-settings.js";
import "./department-settings.js";
const model: VenueServiceView = {
  departments: [
    {
      id: "d1",
      name: "Restaurant",
      tradingName: "Casa",
      defaultServiceMode: "table_tab",
      active: true,
    },
    { id: "d2", name: "Deli", tradingName: "Shop", defaultServiceMode: "prepay", active: true },
    {
      id: "d3",
      name: "Closed",
      tradingName: "Closed",
      defaultServiceMode: "prepay",
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
      serviceModeOverride: "prepay",
      active: true,
    },
    {
      id: "z2",
      name: "Bar",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: true,
    },
    {
      id: "z3",
      name: "Same",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
      serviceModeOverride: null,
      active: true,
    },
    {
      id: "z4",
      name: "Other",
      departmentId: "d2",
      departmentName: "Deli",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
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
  releaseReminderMinutes: null,
  clearingWorkflow: false,
};

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  hosts.splice(0).forEach((h) => h.remove());
  setLocale("en");
});
async function mount(view = structuredClone(model), failure?: unknown) {
  const writes: { path: string; method: string; body: unknown }[] = [];
  const api = new VenueServiceApi((async (path, method, body) => {
    if (method === "GET")
      return path.endsWith("/profiles")
        ? [
            { id: "p1", name: "Restaurant desk" },
            { id: "p2", name: "Handheld desk" },
          ]
        : { departmentId: "d1", receivingProfileId: "p1", destinationDepartmentIds: [] };
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
  await expect.poll(() => el.shadowRoot!.querySelector("[name=name]")).not.toBeNull();
  if (view.departments.filter((d) => d.active).length > 1)
    await expect
      .poll(() => el.shadowRoot!.querySelector("[name=receivingProfileId]"))
      .not.toBeNull();
  return { el, writes };
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
  field(el, "printTradingName").dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
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
        receiptPrintMode: "on_request",
        printTradingName: true,
        transfers: { receivingProfileId: "p2", destinationDepartmentIds: ["d2"] },
      },
    },
  ]);
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
it("links to the receipt editor for this department", async () => {
  const { el } = await mount();
  expect(
    el
      .shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=edit-receipt]")!
      .getAttribute("href"),
  ).toBe("/manage/venue-settings/view/receipts?departmentId=d1");
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
it("a disabled department is read-only, has no Save and offers Enable", async () => {
  const view = structuredClone(model);
  view.departments[0]!.active = false;
  const { el } = await mount(view);
  expect(el.shadowRoot!.textContent).toContain("Enable this department to change its settings");
  expect(save(el)).toBeNull();
  expect(field(el, "name").disabled).toBe(true);
  expect(field(el, "tradingName").disabled).toBe(true);
  expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.disabled).toBe(true);
  expect(field(el, "printTradingName").hasAttribute("disabled")).toBe(true);
  const heard: unknown[] = [];
  el.addEventListener("enable-department", (e) => heard.push((e as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=enable-department]")!.click();
  expect(heard).toEqual([{ departmentId: "d1" }]);
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
it("a disabled-name clash sits beside the name with Enable", async () => {
  const { el } = await mount(structuredClone(model), {
    code: "department.name_disabled",
    params: { departmentId: "d3", name: "Closed" },
  });
  await change(el, "name", "Closed");
  save(el).click();
  await expect
    .poll(() => field(el, "name").error)
    .toBe("A disabled department already has this name. Enable it instead.");
  expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")!.textContent).toContain(
    "Enable Closed",
  );
  expect(save(el).disabled).toBe(false);
  const heard: unknown[] = [];
  el.addEventListener("enable-department", (e) => heard.push((e as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=enable-name-clash]")!.click();
  expect(heard).toEqual([{ departmentId: "d3" }]);
  await change(el, "name", "Other");
  expect(field(el, "name").error).toBe("");
  expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
});
it.each([
  "name",
  "tradingName",
  "printTradingName",
  "orderStart",
  "paidWhen",
  "collectionNumber",
  "receiptPrintMode",
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
      : name === "printTradingName"
        ? el.shadowRoot!.querySelector("[data-field-error=printTradingName]")?.textContent
        : ["orderStart", "paidWhen", "collectionNumber", "receiptPrintMode"].includes(name)
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
    defaultServiceMode: "prepay",
    active: true,
  });
  const { el } = await mount(view);
  const service = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  const update = async (receiptPrintMode: "auto" | "on_request") => {
    service.dispatchEvent(
      new CustomEvent("service-settings-change", {
        detail: {
          value: {
            orderStart: "table",
            paidWhen: "prepay",
            collectionNumber: "none",
            receiptPrintMode,
          },
        },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
  };
  await update("on_request");
  expect(save(el).disabled).toBe(false);
  await update("auto");
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
  view.salePolicies.zones[1]!.receiptPrintMode = null;
  const { el } = await mount(view);
  const service = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  service.dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: {
        value: {
          orderStart: "table",
          paidWhen: "prepay",
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
  ).toEqual(["Terrace (Counter service)", "Same (Always)"]);
});
it("a request failure naming no field stays at the bottom and allows retry", async () => {
  const { el } = await mount(structuredClone(model), { code: "connection.failed" });
  await change(el, "name", "Revised");
  save(el).click();
  await expect.poll(() => bottom(el)).toBe("The change could not be saved.");
  expect(field(el, "name").error).toBe("");
  expect(save(el).disabled).toBe(false);
});
it("a disabled department's transfer controls retain their values but cannot edit", async () => {
  const view = structuredClone(model);
  view.departments[0]!.active = false;
  view.departments.push({
    id: "d4",
    name: "Cafe",
    tradingName: "Coffee",
    defaultServiceMode: "prepay",
    active: true,
  });
  const { el } = await mount(view);
  const box = el.shadowRoot!.querySelector(
    "[name=receivingProfileId]",
  ) as HTMLElementTagNameMap["wt-combobox"];
  expect(box.disabled).toBe(true);
  expect(box.value).toBe("p1");
  const fieldset = el.shadowRoot!.querySelector("fieldset")!;
  expect(fieldset.disabled).toBe(true);
  box.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "p2" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(box.value).toBe("p1");
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
    "Same (Table service, Paid before preparation, Don't print, Always)",
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
  "a department without a policy row displays its %s service defaults",
  async (mode) => {
    const view = structuredClone(model);
    view.salePolicies.departments = [];
    view.departments[0]!.defaultServiceMode = mode;
    const { el } = await mount(view);
    expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")!.value).toMatchObject(
      mode === "table_tab"
        ? {
            orderStart: "table",
            paidWhen: "prepay",
            collectionNumber: "none",
            receiptPrintMode: "auto",
          }
        : {
            orderStart: "counter",
            paidWhen: "ticket_then_pay",
            collectionNumber: "none",
            receiptPrintMode: "auto",
          },
    );
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
    defaultServiceMode: "prepay",
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
    defaultServiceMode: "prepay",
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
  el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=edit-receipt]")!.click();
  expect(shell).toEqual(["/manage/venue-settings/view/receipts?departmentId=d1"]);
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
  expect(shell).toHaveLength(1);
});

it.each([
  ["orderStart", "counter", "paidWhen", "ticket_then_pay"],
  ["paidWhen", "ticket_then_pay", "receiptPrintMode", "on_request"],
  ["collectionNumber", "numbered", "paidWhen", "ticket_then_pay"],
  ["receiptPrintMode", "on_request", "paidWhen", "ticket_then_pay"],
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
