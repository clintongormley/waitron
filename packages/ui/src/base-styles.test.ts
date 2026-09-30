import { afterEach, expect, test } from "vitest";
import { floorTrayStyles, selectStyles } from "./base-styles.js";
import { floorChipStyles } from "./floor-chips.js";
import { cleanup, mount } from "./test-helpers.js";

afterEach(cleanup);

// Checks for hex literals only, and only in the stylesheets named in this table.
test.each([
  ["selectStyles", selectStyles],
  ["floorTrayStyles", floorTrayStyles],
  ["floorChipStyles", floorChipStyles],
])("%s declares no literal colours", (_name, styles) => {
  expect(styles.cssText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
});

test("selectStyles is the full-width form select", () => {
  expect(selectStyles.cssText).toContain("width: 100%");
  expect(selectStyles.cssText).toContain("select");
});

test("a select marked invalid draws its border in the danger colour, and only then", async () => {
  const wrapper = await mount("<div></div>");
  wrapper.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
  wrapper.style.setProperty("--wt-color-border", "rgb(7, 8, 9)");
  const shadow = wrapper.attachShadow({ mode: "open" });
  shadow.adoptedStyleSheets = [selectStyles.styleSheet!];
  shadow.innerHTML =
    '<select aria-invalid="true"><option>a</option></select><select aria-invalid="false"><option>a</option></select>';
  const [refused, accepted] = shadow.querySelectorAll("select");
  expect(getComputedStyle(refused!).borderColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(accepted!).borderColor).toBe("rgb(7, 8, 9)");
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
