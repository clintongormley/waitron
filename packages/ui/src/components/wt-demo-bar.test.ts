import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtDemoBar } from "./wt-demo-bar.js";
import "./wt-demo-bar.js";

afterEach(cleanup);

test("marks the current page and keeps the other destinations as links", async () => {
  const el = (await mount("<wt-demo-bar></wt-demo-bar>")) as WtDemoBar;
  el.modeLabel = "Demo";
  el.navigationLabel = "Demo navigation";
  el.links = [
    { label: "Dashboard", href: "/manage", current: true },
    { label: "Device", href: "/" },
  ];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("nav")?.getAttribute("aria-label")).toBe("Demo navigation");
  expect(el.shadowRoot!.querySelector("strong")?.textContent).toBe("Demo");
  expect(el.shadowRoot!.querySelector('[aria-current="page"]')?.textContent).toBe("Dashboard");
  expect(el.shadowRoot!.querySelector('a[href="/manage"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('a[href="/"]')?.textContent).toBe("Device");
});

test("paints the raised surface, border and text from tokens", async () => {
  const el = (await mount("<wt-demo-bar></wt-demo-bar>")) as WtDemoBar;
  host.style.setProperty("--wt-color-surface-raised", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-border", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-text", "rgb(7, 8, 9)");
  expect(getComputedStyle(el).backgroundColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(el).borderBottomColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(el).color).toBe("rgb(7, 8, 9)");
});
