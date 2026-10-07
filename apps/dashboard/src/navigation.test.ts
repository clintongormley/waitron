import { afterEach, expect, it } from "vitest";
import { LitElement } from "lit";
import { UrlStateController } from "@waitron/ui";
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

it("preserves the Menu timetable department a link names when the dashboard rewrites its destination", () => {
  history.replaceState(null, "", "/manage/menu-timetable/department/deli");
  const host = document.createElement("test-dashboard-navigation-host") as NavigationHost;
  hosts.push(host);
  const url = new UrlStateController(host, () => {}, dashboardPath);
  document.body.append(host);
  expect(url.read("department")).toBe("deli");
  url.write({ dashboard: "menu-timetable" }, true);
  expect(location.pathname).toBe("/manage/menu-timetable/department/deli");
});

it("preserves the Hours tab and the subject a link names when the dashboard rewrites its destination", () => {
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
  expect(location.pathname).toBe("/manage/hours/view/week/department/deli");
});
