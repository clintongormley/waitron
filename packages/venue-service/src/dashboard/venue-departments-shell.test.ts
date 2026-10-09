import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import "./venue-departments-shell.js";

const initialUrl = location.href;
const hosts: HTMLElement[] = [];
const department = (id: string, active = true) => ({
  id,
  name: `Department ${id}`,
  tradingName: `Trading ${id}`,

  active,
});
function model(count = 2): VenueServiceView {
  return {
    departments: Array.from({ length: count }, (_, i) => department(`d${i + 1}`, i === 0)),
    zones: ["z1", "z2"].map((id) => ({
      id,
      name: id,
      departmentId: "d1",
      departmentName: "Department d1",
      serviceMode: "prepay",
      active: true,
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
async function mount(path = "/manage/venue-operations", view = model()) {
  history.replaceState(null, "", `${path}?dev=1&source=saved`);
  const shell = document.createElement("venue-departments-shell");
  applyTokens(shell);
  shell.model = view;
  const reads = {
    loadDepartmentTransfers: vi.fn().mockResolvedValue({
      departmentId: "d1",
      receivingProfileId: null,
      destinationDepartmentIds: [],
    }),
    listDeviceProfiles: vi.fn().mockResolvedValue([]),
  };
  shell.api = { ...reads, background: reads } as unknown as VenueServiceApi;
  hosts.push(shell);
  document.body.append(shell);
  await shell.updateComplete;
  return shell;
}
function emit(el: HTMLElement, name: string, detail: object) {
  el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
it.each([0, 1, 2])("bare address always renders the list with %i departments", async (count) => {
  const shell = await mount(undefined, model(count));
  const list = shell.shadowRoot!.querySelector("departments-list");
  expect(list).not.toBeNull();
  expect(list!.model!.departments).toEqual(model(count).departments);
  expect(shell.shadowRoot!.querySelector("department-page")).toBeNull();
  expect(location.pathname).toBe("/manage/venue-operations");
});
it("Open pushes the selected department page and keeps unrelated query values", async () => {
  const shell = await mount();
  const push = vi.spyOn(history, "pushState");
  emit(shell.shadowRoot!.querySelector("departments-list")!, "open-department", {
    departmentId: "d2",
  });
  await shell.updateComplete;
  await expect.poll(() => shell.shadowRoot!.querySelector("department-page")).not.toBeNull();
  const page = shell.shadowRoot!.querySelector("department-page");
  expect(page).not.toBeNull();
  expect(page!.departmentId).toBe("d2");
  await page!.updateComplete;
  expect(page!.shadowRoot!.querySelector("h1")!.textContent).toBe("Department d2");
  expect(page!.shadowRoot!.querySelector("nav a")!.getAttribute("href")).toBe(
    "/manage/venue-operations",
  );
  expect(location.pathname).toBe("/manage/venue-operations/department/d2");
  expect(location.search).toBe("?dev=1&source=saved");
  expect(push).toHaveBeenCalledTimes(1);
});
it("a direct department address selects Settings without replacing history", async () => {
  const replace = vi.spyOn(history, "replaceState");
  const shell = await mount("/manage/venue-operations/department/d1");
  expect(shell.shadowRoot!.querySelector("department-page")!.view).toBe("settings");
  expect(replace).toHaveBeenCalledTimes(1);
});
it("a tab pushes and a zone replaces the address, and Settings removes zone", async () => {
  const shell = await mount("/manage/venue-operations/department/d1");
  const push = vi.spyOn(history, "pushState");
  const replace = vi.spyOn(history, "replaceState");
  emit(shell.shadowRoot!.querySelector("department-page")!, "view-change", { view: "zones" });
  await shell.updateComplete;
  expect(location.pathname).toBe("/manage/venue-operations/department/d1/view/zones");
  const zones = shell.shadowRoot!.querySelector("department-zones");
  expect(zones).not.toBeNull();
  expect(zones!.getAttribute("slot")).toBe("zones");
  expect(zones!.departmentId).toBe("d1");
  emit(zones!, "zone-change", { zoneId: "z2" });
  await shell.updateComplete;
  expect(location.pathname).toBe("/manage/venue-operations/department/d1/view/zones/zone/z2");
  await expect.poll(() => zones!.zone).toBe("z2");
  expect(push).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledTimes(1);
  emit(shell.shadowRoot!.querySelector("department-page")!, "view-change", { view: "settings" });
  await shell.updateComplete;
  expect(location.pathname).toBe("/manage/venue-operations/department/d1");
  expect(push).toHaveBeenCalledTimes(2);
});
it("Settings' differing-zone link selects the Zones tab with a replacement", async () => {
  const shell = await mount("/manage/venue-operations/department/d1");
  const page = shell.shadowRoot!.querySelector("department-page")!;
  await page.updateComplete;
  const replace = vi.spyOn(history, "replaceState");
  emit(page.shadowRoot!.querySelector("department-settings")!, "zone-change", { zoneId: "z2" });
  await shell.updateComplete;
  expect(location.pathname).toBe("/manage/venue-operations/department/d1/view/zones/zone/z2");
  expect(replace).toHaveBeenCalledTimes(1);
});
it.each(["departments", "zones", "status", "missing", "menus", "kitchen"])(
  "old %s bookmarks replace to the list",
  async (view) => {
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const shell = await mount(`/manage/venue-operations/view/${view}`);
    expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
    expect(location.pathname).toBe("/manage/venue-operations");
    expect(location.search).toBe("?dev=1&source=saved");
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(2);
  },
);
it.each(["en", "es"] as const)(
  "unknown department keeps its address and explains itself in %s",
  async (locale) => {
    setLocale(locale);
    const shell = await mount("/manage/venue-operations/department/gone");
    expect(shell.shadowRoot!.querySelector("department-page")).toBeNull();
    expect(shell.shadowRoot!.querySelector("[role=status]")!.textContent!.trim()).toBe(
      locale === "en" ? "This department no longer exists." : "Este departamento ya no existe.",
    );
    expect(shell.shadowRoot!.querySelector("nav a")!.getAttribute("href")).toBe(
      "/manage/venue-operations",
    );
    expect(location.pathname).toBe("/manage/venue-operations/department/gone");
  },
);
it("accepted history changes return to the list and do not write another entry", async () => {
  const shell = await mount("/manage/venue-operations/department/d1/view/zones/zone/z2");
  expect(shell.shadowRoot!.querySelector("department-zones")!.zone).toBe("z2");
  history.replaceState(null, "", "/manage/venue-operations?dev=1&source=saved");
  const push = vi.spyOn(history, "pushState");
  const replace = vi.spyOn(history, "replaceState");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector("departments-list")).not.toBeNull();
  expect(shell.shadowRoot!.querySelector("department-page")).toBeNull();
  expect(push).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});
it("a zone outside this department falls back to its first zone without changing the URL", async () => {
  const shell = await mount("/manage/venue-operations/department/d1/view/zones/zone/elsewhere");
  const zones = shell.shadowRoot!.querySelector("department-zones")!;
  await zones.updateComplete;
  expect(zones.shadowRoot!.querySelector("h2")!.textContent).toBe("z1");
  expect(location.pathname).toBe(
    "/manage/venue-operations/department/d1/view/zones/zone/elsewhere",
  );
});
