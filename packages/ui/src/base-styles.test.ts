import { afterEach, expect, test } from "vitest";
import { floorTrayStyles, selectStyles } from "./base-styles.js";
import { cleanup, mount } from "./test-helpers.js";

afterEach(cleanup);

// Checks for hex literals only, and only in the stylesheets named in this table.
test.each([
  ["selectStyles", selectStyles],
  ["floorTrayStyles", floorTrayStyles],
])("%s declares no literal colours", (_name, styles) => {
  expect(styles.cssText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
});

test("selectStyles is the full-width form select", () => {
  expect(selectStyles.cssText).toContain("width: 100%");
  expect(selectStyles.cssText).toContain("select");
});

test("the shared floor tray lays its unplaced tables out as a wrapping row", async () => {
  const wrapper = await mount("<div></div>");
  const shadow = wrapper.attachShadow({ mode: "open" });
  shadow.adoptedStyleSheets = [floorTrayStyles.styleSheet!];
  shadow.innerHTML = '<div class="tray"><button class="tray-item">T1</button></div>';
  const style = getComputedStyle(shadow.querySelector<HTMLElement>(".tray")!);
  expect(style.display).toBe("flex");
  expect(style.flexWrap).toBe("wrap");
});
