import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-card.js";

afterEach(cleanup);

test("renders default and header slots", async () => {
  const el = await mount('<wt-card><span slot="header">Total</span><span>12,40 €</span></wt-card>');
  const slots = [...el.shadowRoot!.querySelectorAll("slot")].map((s) => s.getAttribute("name"));
  expect(slots).toContain("header");
  expect(slots).toContain(null);
});

test("does not add a spurious gap when no header content is provided", async () => {
  const el = await mount("<wt-card>x</wt-card>");
  const header = el.shadowRoot!.querySelector(".header")!;
  expect(getComputedStyle(header).marginBottom).toBe("0px");
});

test("paints from the surface token", async () => {
  const el = await mount("<wt-card>x</wt-card>");
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  const inner = el.shadowRoot!.querySelector(".card")!;
  expect(getComputedStyle(inner).backgroundColor).toBe("rgb(7, 8, 9)");
});

test("raised uses the raised surface token", async () => {
  const el = await mount("<wt-card raised>x</wt-card>");
  host.style.setProperty("--wt-color-surface-raised", "rgb(10, 11, 12)");
  const inner = el.shadowRoot!.querySelector(".card")!;
  expect(getComputedStyle(inner).backgroundColor).toBe("rgb(10, 11, 12)");
});
