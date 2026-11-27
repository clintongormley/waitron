import { expect, it } from "vitest";
import { checkedCustomerMenuAppearance } from "./customer-menu-styles.js";

function refuse(field: string): never {
  throw new Error(field);
}

it.each([
  {},
  { pageColor: "#fbf7ef", textFont: "system" },
  {
    pageColor: "#1f2928",
    textColor: "#f5f1e7",
    headingColor: "#f5b995",
    textFont: "serif",
    headingFont: "system",
  },
])("preserves a valid style and its absent fields", (appearance) => {
  expect(checkedCustomerMenuAppearance(appearance, refuse)).toEqual(appearance);
});

it.each([
  [null, "appearance"],
  [[], "appearance"],
  [{ pageColor: "red" }, "pageColor"],
  [{ textColor: null }, "textColor"],
  [{ headingColor: "#abc" }, "headingColor"],
  [{ headingFont: "display" }, "headingFont"],
  [{ textFont: ["serif"] }, "textFont"],
  [{ logo: "photo.webp" }, "logo"],
])("refuses invalid style %j at %s", (input, field) => {
  expect(() => checkedCustomerMenuAppearance(input, refuse)).toThrowError(field);
});
