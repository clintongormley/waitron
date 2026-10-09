import { afterEach, expect, it } from "vitest";
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
  history.replaceState(null, "", before);
});

it("preserves the Prep stations tab and tester when the dashboard rewrites its destination", () => {
  history.replaceState(null, "", "/manage/prep-stations/view/tickets/test/bread");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  expect(url.read("view")).toBe("tickets");
  expect(url.read("test")).toBe("bread");
  url.write({ dashboard: "prep-stations" }, true);
  expect(location.pathname).toBe("/manage/prep-stations/view/tickets/test/bread");
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

it("preserves the Station hours tab and the station a link names when the dashboard rewrites its destination", () => {
  history.replaceState(null, "", "/manage/hours/view/week/station/bar");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  expect(url.read("department")).toBeNull();
  expect(url.read("station")).toBe("bar");
  url.write({ dashboard: "hours" }, true);
  expect(location.pathname).toBe("/manage/hours/view/week/station/bar");
  url.write({ station: null, department: "deli" }, true);
  expect(location.pathname).toBe("/manage/hours/view/week");
  expect(url.read("department")).toBeNull();
});

it("drops a department from a Station hours destination while preserving its station", () => {
  history.replaceState(null, "", "/manage/hours/view/calendar/department/deli/station/bar");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  expect(url.read("department")).toBeNull();
  expect(url.read("station")).toBe("bar");
  url.write({ dashboard: "hours" }, true);
  expect(location.pathname).toBe("/manage/hours/view/calendar/station/bar");
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
