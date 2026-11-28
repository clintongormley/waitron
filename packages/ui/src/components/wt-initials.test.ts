import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-initials.js";

afterEach(cleanup);

test("shows two initials with the theme's foreground and fill in a circular badge", async () => {
  const el = await mount('<wt-initials name="  Javier Torres  "></wt-initials>');
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-on-primary", "rgb(4, 5, 6)");
  const badge = el.shadowRoot?.querySelector("span");
  expect(badge?.textContent).toBe("JT");
  const style = getComputedStyle(badge!);
  expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
  expect(style.color).toBe("rgb(4, 5, 6)");
  expect(badge!.getBoundingClientRect().width).toBe(44);
});

test("the large badge measures 72 pixels and capitalizes the name in its locale", async () => {
  const el = await mount('<wt-initials name="izzy green" locale="tr" size="lg"></wt-initials>');
  const badge = el.shadowRoot?.querySelector("span");
  expect(badge?.textContent).toBe("\u0130G");
  expect(badge!.getBoundingClientRect().width).toBe(72);
});
