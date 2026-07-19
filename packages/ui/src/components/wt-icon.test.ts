import { expect, test, afterEach } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-icon.js";

afterEach(cleanup);

test("renders a registered icon", async () => {
  registerIcons({ check: "M2 8 L6 12 L14 4" });
  const el = await mount('<wt-icon name="check"></wt-icon>');
  const path = el.shadowRoot!.querySelector("path");
  expect(path?.getAttribute("d")).toBe("M2 8 L6 12 L14 4");
});

test("renders nothing for an unregistered icon", async () => {
  const el = await mount('<wt-icon name="nope"></wt-icon>');
  expect(el.shadowRoot!.querySelector("path")).toBeNull();
});

test("inherits colour from its context", async () => {
  registerIcons({ check: "M2 8 L6 12 L14 4" });
  const el = await mount('<wt-icon name="check"></wt-icon>');
  el.style.color = "rgb(4, 5, 6)";
  const svg = el.shadowRoot!.querySelector("svg")!;
  expect(getComputedStyle(svg).fill).toBe("rgb(4, 5, 6)");
});
