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
