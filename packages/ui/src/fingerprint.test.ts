import { render } from "lit";
import { expect, test } from "vitest";
import { breakAfterColons } from "./fingerprint.js";

function drawn(value: string): HTMLElement {
  const host = document.createElement("span");
  render(breakAfterColons(value), host);
  return host;
}

test("draws the value's own text, adding a break chance after each colon and nowhere else", () => {
  const host = drawn("3F:A1:9C");
  expect(host.textContent).toBe("3F:A1:9C");
  const breaks = [...host.querySelectorAll("wbr")];
  expect(breaks).toHaveLength(2);
  for (const wbr of breaks) {
    expect(wbr.previousSibling?.textContent?.endsWith(":")).toBe(true);
  }
  expect(host.lastChild?.textContent).not.toBe("");
  expect(host.innerHTML.replace(/<!--[^>]*-->/g, "")).toBe("3F:<wbr>A1:<wbr>9C");
});

test("draws a value with no colon as it is", () => {
  const host = drawn("ABCD");
  expect(host.textContent).toBe("ABCD");
  expect(host.querySelectorAll("wbr")).toHaveLength(0);
});
