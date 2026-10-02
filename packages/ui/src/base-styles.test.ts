import { afterEach, expect, test } from "vitest";
import { floorTrayStyles } from "./base-styles.js";
import { floorChipStyles } from "./floor-chips.js";
import { cleanup, mount } from "./test-helpers.js";

afterEach(cleanup);

// Checks for hex literals only, and only in the stylesheets named in this table.
test.each([
  ["floorTrayStyles", floorTrayStyles],
  ["floorChipStyles", floorChipStyles],
])("%s declares no literal colours", (_name, styles) => {
  expect(styles.cssText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
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
