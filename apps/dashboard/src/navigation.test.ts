import { afterEach, expect, it, vi } from "vitest";
import { LitElement } from "lit";
import { UrlStateController } from "@waitron/ui";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "./icons.js";
import { dashboardPath } from "./navigation.js";

class NavigationHost extends LitElement {}
customElements.define("test-dashboard-navigation-host", NavigationHost);

const hosts: LitElement[] = [];
const before = location.href;
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  vi.restoreAllMocks();
  history.replaceState(null, "", before);
});

it.each([
  { path: "/manage/venue-operations/department/deli", department: "deli", view: null, zone: null },
  {
    path: "/manage/venue-operations/department/deli/view/zones",
    department: "deli",
    view: "zones",
    zone: null,
  },
  {
    path: "/manage/venue-operations/department/deli/view/zones/zone/patio",
    department: "deli",
    view: "zones",
    zone: "patio",
  },
  {
    path: "/manage/venue-operations/department/deli%2Fbar/view/zones/zone/patio%2Froof",
    department: "deli/bar",
    view: "zones",
    zone: "patio/roof",
  },
])(
  "preserves department navigation through a dashboard rewrite: $path",
  ({ path, department, view, zone }) => {
    history.replaceState(null, "", `${path}?dev=1&source=saved%20link#settings`);
    const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
    hosts.push(host);
    const url = new UrlStateController(host, () => {}, dashboardPath);
    document.body.append(host);
    expect(url.read("department")).toBe(department);
    expect(url.read("view")).toBe(view);
    expect(url.read("zone")).toBe(zone);
    const push = vi.spyOn(history, "pushState");
    url.write({ dashboard: "venue-operations" }, true);
    expect(location.pathname).toBe(path);
    expect(location.search).toBe("?dev=1&source=saved%20link");
    expect(location.hash).toBe("#settings");
    expect(push).not.toHaveBeenCalled();
  },
);

it("pushes a department tab, replaces its zone, and clears both when returning to Departments", () => {
  history.replaceState(null, "", "/manage/venue-operations/department/deli?dev=1");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  const push = vi.spyOn(history, "pushState");
  const replace = vi.spyOn(history, "replaceState");
  url.write({ view: "zones" });
  expect(location.pathname).toBe("/manage/venue-operations/department/deli/view/zones");
  expect(push).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
  url.write({ zone: "patio" }, true);
  expect(location.pathname).toBe("/manage/venue-operations/department/deli/view/zones/zone/patio");
  expect(push).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledTimes(1);
  url.write({ department: null, view: null, zone: null });
  expect(location.pathname).toBe("/manage/venue-operations");
  expect(location.search).toBe("?dev=1");
  expect(push).toHaveBeenCalledTimes(2);
});

it("preserves the Prep stations tab when the dashboard rewrites its destination, and drops an old tester's product", () => {
  history.replaceState(null, "", "/manage/prep-stations/view/tickets/test/bread");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  expect(url.read("view")).toBe("tickets");
  expect(url.read("test")).toBeNull();
  url.write({ dashboard: "prep-stations" }, true);
  expect(location.pathname).toBe("/manage/prep-stations/view/tickets");
});

it("preserves the Opening hours tab and department a link names when the dashboard rewrites its destination", () => {
  history.replaceState(null, "", "/manage/opening-hours/view/periods/department/deli");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  expect(url.read("department")).toBe("deli");
  expect(url.read("view")).toBe("periods");
  url.write({ dashboard: "opening-hours" }, true);
  expect(location.pathname).toBe("/manage/opening-hours/view/periods/department/deli");
});

it("ignores a retired Station hours station child when rewriting its destination", () => {
  history.replaceState(null, "", "/manage/hours/view/week/station/bar");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  expect(url.read("department")).toBeNull();
  expect(url.read("station")).toBeNull();
  url.write({ dashboard: "hours" }, true);
  expect(location.pathname).toBe("/manage/hours/view/week");
  url.write({ station: null, department: "deli" }, true);
  expect(location.pathname).toBe("/manage/hours/view/week");
  expect(url.read("department")).toBeNull();
});

it("drops station and department children from a retired Station hours destination", () => {
  history.replaceState(null, "", "/manage/hours/view/calendar/department/deli/station/bar");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  expect(url.read("department")).toBeNull();
  expect(url.read("station")).toBeNull();
  url.write({ dashboard: "hours" }, true);
  expect(location.pathname).toBe("/manage/hours/view/calendar");
});

it("preserves the explicit menu price filter when the dashboard rewrites its destination", () => {
  history.replaceState(null, "", "/manage/menus/menu/drinks/view/prices/filter/clashes");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  url.write({ dashboard: "menus" }, true);
  expect(location.pathname).toBe("/manage/menus/menu/drinks/view/prices/filter/clashes");
  expect(url.read("price-filter")).toBe("clashes");
});

it("preserves Opening hours zone and All departments URLs", async () => {
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  history.replaceState(
    null,
    "",
    "/manage/opening-hours/view/week/department/restaurant/zone/terrace",
  );
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  expect(url.read("zone")).toBe("terrace");
  await url.write({ dashboard: "opening-hours" }, true);
  expect(location.pathname).toBe(
    "/manage/opening-hours/view/week/department/restaurant/zone/terrace",
  );
  await url.write({ department: "all", zone: null }, true);
  expect(location.pathname).toBe("/manage/opening-hours/view/week/department/all");
  expect(url.read("department")).toBe("all");
});

it("preserves an Opening hours Calendar month while the shell replaces its section", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/calendar/month/2027-02?keep=yes");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  document.body.append(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  await url.write({ dashboard: "opening-hours" }, true);
  expect(location.pathname).toBe("/manage/opening-hours/view/calendar/month/2027-02");
  expect(location.search).toBe("?keep=yes");
  host.remove();
});

it("draws the Calendar's own-hours clock from the dashboard registry", async () => {
  registerIcons(DASHBOARD_ICONS);
  const icon = document.createElement("wt-icon");
  icon.name = "clock";
  document.body.append(icon);
  await icon.updateComplete;
  expect(icon.shadowRoot!.querySelector("path")).not.toBeNull();
  icon.remove();
});

it("declares no Station hours destination while retaining Opening hours navigation", () => {
  expect(dashboardPath.children).not.toHaveProperty("hours");
  expect(dashboardPath.children!["opening-hours"]).toEqual({
    view: "view",
    department: "department",
    zone: "zone",
    station: "station",
    month: "month",
  });
});

it("reads the floor plan editor's zone from its path", () => {
  history.replaceState(null, "", "/manage/floor-plan/zone/z1");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  expect(url.read("zone")).toBe("z1");
});
